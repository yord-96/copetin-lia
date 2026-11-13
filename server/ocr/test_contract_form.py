import unittest
import cv2
import numpy as np
from contract_form_geometry import prepare_form
from contract_form_extract import number, numeric_evidence, row_centers


class ContractFormTests(unittest.TestCase):
    def test_blank_page_is_not_a_form(self):
        _, metadata = prepare_form(np.full((1200, 800, 3), 255, np.uint8))
        self.assertFalse(metadata['rectified'])

    def test_perspective_grid_can_be_rectified_without_known_photo_coordinates(self):
        image = np.full((1200, 800, 3), 255, np.uint8)
        for x in [60, 90, 340, 420, 500, 580, 660, 740]:
            cv2.line(image, (x, 200), (x, 1131), (0, 0, 0), 1)
        for index in range(50):
            y = 200+index*19
            cv2.line(image, (60, y), (740, y), (0, 0, 0), 1)
        matrix = cv2.getPerspectiveTransform(np.float32([[0, 0], [799, 0], [799, 1199], [0, 1199]]),
                                             np.float32([[15, 50], [760, 5], [799, 1160], [0, 1199]]))
        skewed = cv2.warpPerspective(image, matrix, (800, 1200), borderValue=(255, 255, 255))
        output, metadata = prepare_form(skewed)
        self.assertTrue(metadata['rectified'])
        self.assertEqual(output.shape, image.shape)

    def test_numeric_cells_do_not_silently_convert_merged_values(self):
        self.assertIsNone(number('32.960'))
        self.assertIsNone(number('H13,20'))
        self.assertIsNone(number('-5', integer=True))
        self.assertIsNone(number('1.5', integer=True))
        self.assertEqual(number('1,20'), 1.2)

    def test_page_evidence_restores_a_digit_cut_by_a_cell_border(self):
        rows = [{'text': '3120', 'score': .99, 'x': 680, 'y': 1136},
                {'text': '32.960', 'score': .99, 'x': 632, 'y': 1191}]
        self.assertEqual(numeric_evidence(rows, 626, 720, 1138, 16, '312', .95), ('3120', .99))
        self.assertEqual(numeric_evidence(rows, 626, 720, 1190, 16, '960', .95), ('960', .95))

    def test_unreliable_row_numbering_fails_instead_of_associating_wrong_cells(self):
        with self.assertRaises(ValueError):
            row_centers([], 440, 94, 1448)


if __name__ == '__main__':
    unittest.main()
