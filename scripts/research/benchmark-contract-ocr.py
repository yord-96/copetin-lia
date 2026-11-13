"""Offline OCR experiment. Outputs raw text/boxes, never creates contracts."""
import argparse
import json
import os
import time
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import psutil
from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", type=Path)
    parser.add_argument("--recognizer", choices=["v5-latin", "v6-small"], default="v6-small")
    parser.add_argument("--output", type=Path, required=True,
                        help="Private output directory: results contain client data.")
    args = parser.parse_args()
    if any(not image.is_file() for image in args.images):
        parser.error("One or more input images do not exist.")
    args.output.mkdir(parents=True, exist_ok=True)
    engine = RapidOCR(params={
        "Global.model_root_dir": str(args.output.resolve() / "models"),
        "Global.text_score": 0.25,
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Det.model_type": ModelType.MOBILE,
        "Rec.ocr_version": OCRVersion.PPOCRV6 if args.recognizer == "v6-small" else OCRVersion.PPOCRV5,
        "Rec.model_type": ModelType.SMALL if args.recognizer == "v6-small" else ModelType.MOBILE,
        "Rec.lang_type": "es" if args.recognizer == "v6-small" else LangRec.LATIN,
        "EngineConfig.onnxruntime.intra_op_num_threads": 1,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    })
    for index, image in enumerate(args.images, 1):
        started = time.perf_counter()
        result = engine(str(image.resolve()))
        rows = []
        if result.txts is not None:
            rows = [
                {"text": str(text), "score": float(score), "box": box.tolist()}
                for text, score, box in zip(result.txts, result.scores, result.boxes)
            ]
        memory = psutil.Process().memory_info()
        output = {
            "recognizer": args.recognizer,
            "seconds": round(time.perf_counter() - started, 2),
            "rssMiBAfterReading": round(memory.rss / 1024**2, 1),
            "rows": rows,
            "warning": "Raw OCR, not a validated extraction. Confidence is not an accuracy guarantee.",
        }
        destination = args.output / f"ocr-{index}.json"
        destination.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"sample": index, "seconds": output["seconds"],
                          "rssMiBAfterReading": output["rssMiBAfterReading"],
                          "textBoxes": len(rows)}), flush=True)


if __name__ == "__main__":
    main()
