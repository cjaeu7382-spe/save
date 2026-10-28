const form = document.getElementById("qr-form");
const urlInput = document.getElementById("url-input");
const result = document.getElementById("result");
const qrHost = document.getElementById("qrcode");
const qrCanvas = document.getElementById("qr-canvas");
const qrButton = document.getElementById("qr-button");
const qrUrl = document.getElementById("qr-url");
const saveDialog = document.getElementById("save-dialog");
const saveForm = document.getElementById("save-form");
const filenameInput = document.getElementById("filename-input");

const createPanel = document.getElementById("create-panel");
const scanPanel = document.getElementById("scan-panel");
const modeTabs = document.querySelectorAll(".mode-tab");
const scanFileInput = document.getElementById("scan-file");
const uploadScanBtn = document.getElementById("upload-scan-btn");
const cameraScanBtn = document.getElementById("camera-scan-btn");
const scanResult = document.getElementById("scan-result");
const scanText = document.getElementById("scan-text");
const scanOpenLink = document.getElementById("scan-open-link");
const scanCopyBtn = document.getElementById("scan-copy-btn");

const cameraDialog = document.getElementById("camera-dialog");
const cameraVideo = document.getElementById("camera-video");
const cameraCanvas = document.getElementById("camera-canvas");
const cameraStatus = document.getElementById("camera-status");
const cameraCloseBtn = document.getElementById("camera-close");
const openWindowsCameraBtn = document.getElementById("open-windows-camera");

const QR_SIZE = 280;
let currentUrl = "";
let qrInstance = null;
let cameraStream = null;
let scanLoopId = 0;
let lastScannedValue = "";

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  try {
    return new URL(trimmed).href;
  } catch {
    try {
      return new URL(`https://${trimmed}`).href;
    } catch {
      return "";
    }
  }
}

function suggestFilename(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const safe = host.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
    return `qr-${safe || "code"}`;
  } catch {
    return "qr-code";
  }
}

function sanitizeFilename(name) {
  const base = name
    .trim()
    .replace(/\.jpe?g$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

  return base || "qr-code";
}

function generateQr(url) {
  if (typeof QRCode === "undefined") {
    throw new Error("QR 라이브러리를 불러오지 못했습니다.");
  }

  qrHost.innerHTML = "";
  qrInstance = new QRCode(qrHost, {
    text: url,
    width: QR_SIZE,
    height: QR_SIZE,
    colorDark: "#14201c",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M,
  });
}

function syncExportCanvas() {
  const source =
    qrHost.querySelector("canvas") || qrHost.querySelector("img");

  if (!source) {
    throw new Error("QR 이미지를 찾을 수 없습니다.");
  }

  const ctx = qrCanvas.getContext("2d");
  qrCanvas.width = QR_SIZE;
  qrCanvas.height = QR_SIZE;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, QR_SIZE, QR_SIZE);
  ctx.drawImage(source, 0, 0, QR_SIZE, QR_SIZE);
}

function canvasToJpegBlob(canvas, quality = 0.95) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("JPG 변환에 실패했습니다."));
      },
      "image/jpeg",
      quality
    );
  });
}

async function saveWithPicker(blob, filename) {
  if (typeof window.showSaveFilePicker === "function") {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "JPEG Image",
          accept: { "image/jpeg": [".jpg", ".jpeg"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function setMode(mode) {
  const isCreate = mode === "create";
  createPanel.classList.toggle("is-active", isCreate);
  scanPanel.classList.toggle("is-active", !isCreate);

  modeTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.mode === mode);
  });

  if (isCreate) {
    stopCameraScan();
  }
}

function decodeImageData(imageData) {
  if (typeof jsQR !== "function") {
    throw new Error("스캔 라이브러리를 불러오지 못했습니다.");
  }

  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });

  return code ? code.data : "";
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 열 수 없습니다."));
    };
    image.src = url;
  });
}

async function scanImageFile(file) {
  const image = await loadImageFromFile(file);
  const canvas = document.createElement("canvas");
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));

  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const value = decodeImageData(
    ctx.getImageData(0, 0, canvas.width, canvas.height)
  );

  if (!value) {
    throw new Error("이미지에서 QR 코드를 찾지 못했습니다.");
  }

  showScanResult(value);
}

function showScanResult(value) {
  lastScannedValue = value;
  scanText.textContent = value;
  scanResult.hidden = false;
  scanResult.classList.add("is-visible");

  try {
    const parsed = new URL(value);
    scanOpenLink.hidden = false;
    scanOpenLink.href = parsed.href;
  } catch {
    scanOpenLink.hidden = true;
    scanOpenLink.removeAttribute("href");
  }
}

function setCameraStatus(message, type = "") {
  cameraStatus.textContent = message;
  cameraStatus.classList.remove("is-success", "is-error");
  if (type) cameraStatus.classList.add(type);
}

function stopCameraScan() {
  if (scanLoopId) {
    cancelAnimationFrame(scanLoopId);
    scanLoopId = 0;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  cameraVideo.srcObject = null;

  if (cameraDialog.open) {
    cameraDialog.close();
  }
}

function tickCameraScan() {
  if (!cameraStream || cameraVideo.readyState < 2) {
    scanLoopId = requestAnimationFrame(tickCameraScan);
    return;
  }

  const width = cameraVideo.videoWidth;
  const height = cameraVideo.videoHeight;
  if (!width || !height) {
    scanLoopId = requestAnimationFrame(tickCameraScan);
    return;
  }

  const ctx = cameraCanvas.getContext("2d", { willReadFrequently: true });
  cameraCanvas.width = width;
  cameraCanvas.height = height;
  ctx.drawImage(cameraVideo, 0, 0, width, height);

  try {
    const value = decodeImageData(ctx.getImageData(0, 0, width, height));
    if (value) {
      setCameraStatus("QR 코드를 인식했습니다.", "is-success");
      showScanResult(value);
      stopCameraScan();
      return;
    }
  } catch (error) {
    console.error(error);
    setCameraStatus("스캔 중 오류가 발생했습니다.", "is-error");
    stopCameraScan();
    return;
  }

  scanLoopId = requestAnimationFrame(tickCameraScan);
}

async function startCameraScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCameraStatus(
      "이 환경에서는 카메라를 사용할 수 없습니다. 이미지 업로드를 이용해 주세요.",
      "is-error"
    );
    cameraDialog.showModal();
    return;
  }

  if (!window.isSecureContext && location.protocol !== "https:") {
    // localhost는 secure context로 취급됨. file:// 등은 카메라가 막힐 수 있음.
  }

  stopCameraScan();
  setCameraStatus("카메라 권한을 요청하는 중…");
  cameraDialog.showModal();

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    setCameraStatus("QR 코드를 비춰 주세요.");
    scanLoopId = requestAnimationFrame(tickCameraScan);
  } catch (error) {
    console.error(error);
    let message = "카메라를 열지 못했습니다.";

    if (error && error.name === "NotAllowedError") {
      message = "카메라 권한이 거부되었습니다. 브라우저 설정을 확인해 주세요.";
    } else if (error && error.name === "NotFoundError") {
      message = "사용 가능한 카메라를 찾지 못했습니다.";
    } else if (!window.isSecureContext) {
      message =
        "카메라 스캔은 localhost 또는 HTTPS에서만 동작합니다. 이미지 업로드를 이용해 주세요.";
    }

    setCameraStatus(message, "is-error");
  }
}

function openWindowsCameraApp() {
  // Windows 기본 카메라 앱 프로토콜. 스캔 결과는 웹으로 돌아오지 않으므로
  // 촬영 후 이미지 업로드로 이어지도록 안내합니다.
  const link = document.createElement("a");
  link.href = "microsoft.windows.camera:";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  setCameraStatus(
    "Windows 카메라 앱을 열었습니다. 촬영한 사진은 이미지 업로드로 스캔해 주세요.",
    "is-success"
  );
}

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const url = normalizeUrl(urlInput.value);
  if (!url) {
    urlInput.setCustomValidity("올바른 URL을 입력해 주세요.");
    urlInput.reportValidity();
    return;
  }

  urlInput.setCustomValidity("");

  try {
    generateQr(url);
    currentUrl = url;
    qrUrl.textContent = url;
    result.hidden = false;
    result.classList.add("is-visible");
    urlInput.value = url;
  } catch (error) {
    console.error(error);
    alert("QR 코드를 만들지 못했습니다. URL을 다시 확인해 주세요.");
  }
});

urlInput.addEventListener("input", () => {
  urlInput.setCustomValidity("");
});

qrButton.addEventListener("click", () => {
  if (!currentUrl) return;
  filenameInput.value = suggestFilename(currentUrl);
  saveDialog.showModal();
  filenameInput.focus();
  filenameInput.select();
});

saveForm.addEventListener("submit", async (event) => {
  const submitter = event.submitter;
  if (!submitter || submitter.value !== "save") return;

  event.preventDefault();

  const filename = `${sanitizeFilename(filenameInput.value)}.jpg`;

  try {
    syncExportCanvas();
    const blob = await canvasToJpegBlob(qrCanvas);
    await saveWithPicker(blob, filename);
    saveDialog.close();
  } catch (error) {
    if (error && error.name === "AbortError") return;
    console.error(error);
    alert("저장에 실패했습니다. 다시 시도해 주세요.");
  }
});

uploadScanBtn.addEventListener("click", () => {
  scanFileInput.click();
});

scanFileInput.addEventListener("change", async () => {
  const file = scanFileInput.files && scanFileInput.files[0];
  scanFileInput.value = "";
  if (!file) return;

  try {
    await scanImageFile(file);
  } catch (error) {
    console.error(error);
    alert(error.message || "이미지를 스캔하지 못했습니다.");
  }
});

cameraScanBtn.addEventListener("click", () => {
  startCameraScan();
});

cameraCloseBtn.addEventListener("click", () => {
  stopCameraScan();
});

openWindowsCameraBtn.addEventListener("click", () => {
  openWindowsCameraApp();
});

cameraDialog.addEventListener("close", () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  if (scanLoopId) {
    cancelAnimationFrame(scanLoopId);
    scanLoopId = 0;
  }
  cameraVideo.srcObject = null;
});

scanCopyBtn.addEventListener("click", async () => {
  if (!lastScannedValue) return;

  try {
    await navigator.clipboard.writeText(lastScannedValue);
    scanCopyBtn.textContent = "복사됨";
    setTimeout(() => {
      scanCopyBtn.textContent = "복사";
    }, 1200);
  } catch {
    alert("클립보드에 복사하지 못했습니다.");
  }
});

window.addEventListener("beforeunload", () => {
  stopCameraScan();
});
