self.onmessage = async function (event) {
  const buffer = event.data;
  try {
    self.postMessage({ type: "status", message: "GIF 디코더와 ZIP 엔진 준비 중…" });
    const gifuct = await import("https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm");
    const zipModule = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    const JSZip = zipModule.default || zipModule;
    const parsed = gifuct.parseGIF(buffer);
    const decoded = gifuct.decompressFrames(parsed, true);
    const width = Number(parsed.lsd && parsed.lsd.width);
    const height = Number(parsed.lsd && parsed.lsd.height);
    if (!width || !height || !decoded || !decoded.length) throw new Error("유효한 GIF 프레임을 찾지 못했습니다.");

    const outputCanvas = new OffscreenCanvas(width, height);
    const composite = new OffscreenCanvas(width, height);
    const previous = new OffscreenCanvas(width, height);
    const outCtx = outputCanvas.getContext("2d");
    const compCtx = composite.getContext("2d");
    const prevCtx = previous.getContext("2d");
    const zip = new JSZip();
    const background = parsed.gct && parsed.gct[parsed.lsd.backgroundColorIndex];

    for (let i = 0; i < decoded.length; i++) {
      const frame = decoded[i];
      const dims = frame.dims;
      if (frame.patch && dims && dims.width && dims.height) {
        if (frame.disposalType === 3) {
          prevCtx.clearRect(0, 0, width, height);
          prevCtx.drawImage(composite, 0, 0);
        }
        const patch = frame.patch instanceof Uint8ClampedArray ? frame.patch : new Uint8ClampedArray(frame.patch);
        const patchImage = new ImageData(patch, dims.width, dims.height);
        const patchCanvas = new OffscreenCanvas(dims.width, dims.height);
        patchCanvas.getContext("2d").putImageData(patchImage, 0, 0);
        compCtx.drawImage(patchCanvas, dims.left, dims.top);

        outCtx.fillStyle = "#ffffff";
        outCtx.fillRect(0, 0, width, height);
        outCtx.drawImage(composite, 0, 0);
        const jpg = await outputCanvas.convertToBlob({ type: "image/jpeg", quality: 0.94 });
        zip.file("frame-" + String(i + 1).padStart(4, "0") + ".jpg", jpg);

        if (frame.disposalType === 2) {
          if (background && Array.isArray(background)) {
            compCtx.fillStyle = "rgb(" + background[0] + "," + background[1] + "," + background[2] + ")";
            compCtx.fillRect(dims.left, dims.top, dims.width, dims.height);
          } else {
            compCtx.clearRect(dims.left, dims.top, dims.width, dims.height);
          }
        } else if (frame.disposalType === 3) {
          compCtx.clearRect(0, 0, width, height);
          compCtx.drawImage(previous, 0, 0);
        }
      }
      if (i % 2 === 0 || i === decoded.length - 1) {
        self.postMessage({ type: "progress", current: i + 1, total: decoded.length });
      }
      // Let the worker process messages between frames without blocking the page UI.
      if (i % 3 === 2) await new Promise(resolve => setTimeout(resolve, 0));
    }
    self.postMessage({ type: "status", message: "JPG 프레임을 ZIP으로 묶는 중…" });
    const result = await zip.generateAsync({ type: "blob", compression: "STORE" });
    self.postMessage({ type: "done", blob: result, count: decoded.length });
  } catch (error) {
    self.postMessage({ type: "error", message: error && error.message ? error.message : String(error) });
  }
};