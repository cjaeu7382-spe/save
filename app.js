(function () {
  const fileInput = document.getElementById("file-input");
  const dropzone = document.getElementById("dropzone");
  const filmstrip = document.getElementById("filmstrip");
  const frameCount = document.getElementById("frame-count");
  const previewCanvas = document.getElementById("preview-canvas");
  const previewEmpty = document.getElementById("preview-empty");
  const previewStatus = document.getElementById("preview-status");
  const btnMake = document.getElementById("btn-make");
  const progress = document.getElementById("progress");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const download = document.getElementById("download");
  const resultGif = document.getElementById("result-gif");

  const frames = [];
  let dragFrom = null;
  let previewTimer = 0;
  let previewIndex = 0;
  let objectUrl = "";

  function uid() {
    return Math.random().toString(36).slice(2);
  }

  function updateCount() {
    frameCount.textContent = "프레임 " + frames.length;
    btnMake.disabled = frames.length < 2;
    previewEmpty.style.display = frames.length ? "none" : "block";
    previewCanvas.style.display = frames.length ? "block" : "none";
  }

  function renderStrip() {
    filmstrip.innerHTML = "";
    frames.forEach(function (frame, index) {
      const card = document.createElement("article");
      card.className = "frame-card";
      card.draggable = true;
      card.dataset.id = frame.id;
      card.setAttribute("role", "listitem");

      const img = document.createElement("img");
      img.src = frame.thumb;
      img.alt = "프레임 " + (index + 1);
      card.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = "<span>#" + (index + 1) + "</span><span>드래그로 이동</span>";
      card.appendChild(meta);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", "삭제");
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        const i = frames.findIndex(function (f) {
          return f.id === frame.id;
        });
        if (i >= 0) {
          URL.revokeObjectURL(frames[i].thumb);
          frames.splice(i, 1);
          renderStrip();
          restartPreview();
        }
      });
      card.appendChild(remove);

      card.addEventListener("dragstart", function () {
        dragFrom = frame.id;
      });
      card.addEventListener("dragover", function (event) {
        event.preventDefault();
      });
      card.addEventListener("drop", function (event) {
        event.preventDefault();
        if (!dragFrom || dragFrom === frame.id) return;
        const from = frames.findIndex(function (f) {
          return f.id === dragFrom;
        });
        const to = frames.findIndex(function (f) {
          return f.id === frame.id;
        });
        const moved = frames.splice(from, 1)[0];
        frames.splice(to, 0, moved);
        renderStrip();
        restartPreview();
      });

      filmstrip.appendChild(card);
    });
    updateCount();
  }

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        resolve({
          id: uid(),
          source: img,
          thumb: url,
          kind: "image",
        });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function loadVideoFrames(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.src = url;
      video.onloadedmetadata = async function () {
        const duration = Math.min(video.duration || 1, 8);
        const count = Math.min(24, Math.max(6, Math.round(duration * 6)));
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        const extracted = [];
        for (let i = 0; i < count; i++) {
          video.currentTime = (duration * i) / count;
          await new Promise(function (done) {
            video.onseeked = done;
          });
          ctx.drawImage(video, 0, 0);
          const img = new Image();
          const thumb = canvas.toDataURL("image/jpeg", 0.7);
          await new Promise(function (done) {
            img.onload = done;
            img.src = canvas.toDataURL("image/png");
          });
          extracted.push({ id: uid(), source: img, thumb: thumb, kind: "video" });
        }
        URL.revokeObjectURL(url);
        resolve(extracted);
      };
      video.onerror = reject;
    });
  }

  async function addFiles(fileList) {
    const list = Array.from(fileList);
    for (const file of list) {
      if (file.type.startsWith("video/")) {
        const extracted = await loadVideoFrames(file);
        frames.push.apply(frames, extracted);
      } else if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
        frames.push(await loadImageFile(file));
      }
    }
    renderStrip();
    restartPreview();
  }

  function outputSize() {
    const width = Math.max(16, Math.min(1280, Number(document.getElementById("opt-width").value) || 480));
    if (!frames.length) return { width: width, height: Math.round(width * 0.66) };
    const first = frames[0].source;
    const height = Math.max(16, Math.round((width * first.naturalHeight) / first.naturalWidth) || Math.round(width * 0.66));
    return { width: width, height: height };
  }

  function drawFitted(ctx, source, width, height, fit, bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    if (!sw || !sh) return;
    if (fit === "stretch") {
      ctx.drawImage(source, 0, 0, width, height);
      return;
    }
    const scale = fit === "cover" ? Math.max(width / sw, height / sh) : Math.min(width / sw, height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }

  function restartPreview() {
    clearInterval(previewTimer);
    if (!frames.length) {
      previewStatus.textContent = "대기";
      return;
    }
    const size = outputSize();
    previewCanvas.width = size.width;
    previewCanvas.height = size.height;
    previewIndex = 0;
    const delay = Number(document.getElementById("opt-delay").value) || 120;
    const ctx = previewCanvas.getContext("2d");
    const paint = function () {
      const fit = document.getElementById("opt-fit").value;
      const bg = document.getElementById("opt-bg").value;
      drawFitted(ctx, frames[previewIndex].source, size.width, size.height, fit, bg);
      previewStatus.textContent = previewIndex + 1 + " / " + frames.length;
      previewIndex = (previewIndex + 1) % frames.length;
    };
    paint();
    previewTimer = setInterval(paint, delay);
  }

  ["opt-width", "opt-delay", "opt-fit", "opt-bg"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", restartPreview);
    document.getElementById(id).addEventListener("change", restartPreview);
  });

  document.getElementById("btn-add").addEventListener("click", function () {
    fileInput.click();
  });

  document.getElementById("btn-sample").addEventListener("click", async function () {
    const colors = ["#e8a45a", "#c46a3a", "#7d9a6f", "#d7c4a3", "#3d6b8a", "#f4efe6"];
    const words = ["FRAME", "LAB", "MAKE", "A", "GIF", "NOW"];
    for (let i = 0; i < colors.length; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 320;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#14110e";
      ctx.fillRect(0, 0, 480, 320);
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.arc(140 + i * 28, 160, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f4efe6";
      ctx.font = "italic 54px 'Instrument Serif', serif";
      ctx.fillText(words[i], 230, 175);
      const img = new Image();
      const dataUrl = canvas.toDataURL("image/png");
      await new Promise(function (done) {
        img.onload = done;
        img.src = dataUrl;
      });
      frames.push({ id: uid(), source: img, thumb: dataUrl, kind: "sample" });
    }
    renderStrip();
    restartPreview();
  });
  fileInput.addEventListener("change", function () {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", function (event) {
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  });

  document.getElementById("btn-reverse").addEventListener("click", function () {
    frames.reverse();
    renderStrip();
    restartPreview();
  });

  document.getElementById("btn-clear").addEventListener("click", function () {
    frames.splice(0, frames.length);
    renderStrip();
    restartPreview();
    download.hidden = true;
    resultGif.hidden = true;
  });

  document.getElementById("btn-make").addEventListener("click", async function () {
    if (frames.length < 2) return;
    btnMake.disabled = true;
    progress.hidden = false;
    download.hidden = true;
    resultGif.hidden = true;
    progressBar.style.width = "0%";
    progressText.textContent = "캔버스 준비 중";

    const size = outputSize();
    const fit = document.getElementById("opt-fit").value;
    const bg = document.getElementById("opt-bg").value;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageDatas = [];
    for (let i = 0; i < frames.length; i++) {
      drawFitted(ctx, frames[i].source, size.width, size.height, fit, bg);
      imageDatas.push(ctx.getImageData(0, 0, size.width, size.height));
    }

    try {
      const blob = await window.GifLab.encodeGif(
        imageDatas,
        {
          width: size.width,
          height: size.height,
          delay: Number(document.getElementById("opt-delay").value) || 120,
          loop: Number(document.getElementById("opt-loop").value),
          dither: document.getElementById("opt-dither").checked,
        },
        function (ratio) {
          progressBar.style.width = Math.round(ratio * 100) + "%";
          progressText.textContent = "인코딩 " + Math.round(ratio * 100) + "%";
        }
      );
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      download.href = objectUrl;
      download.download = "frame-lab.gif";
      download.hidden = false;
      resultGif.src = objectUrl;
      resultGif.hidden = false;
      progressText.textContent = "완료 · " + Math.round(blob.size / 1024) + " KB";
    } catch (error) {
      progressText.textContent = "실패: " + error.message;
    } finally {
      btnMake.disabled = frames.length < 2;
    }
  });
})();
