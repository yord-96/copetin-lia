function ImageModal({ imagePreview, onClose }) {
  if (!imagePreview) {
    return null;
  }

  return (
    <div className="image-modal-backdrop" onClick={onClose}>
      <div className="image-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h3>{imagePreview.name}</h3>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cerrar
          </button>
        </header>
        <img src={imagePreview.url} alt={imagePreview.name} />
      </div>
    </div>
  );
}

export default ImageModal;
