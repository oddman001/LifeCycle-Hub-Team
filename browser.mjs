import { quantityPreview } from "./quantity.mjs";

const packageSpec = document.querySelector("[data-package-spec]");
const packagePreset = document.querySelector("[data-package-preset]");
const stockPreview = document.querySelector("[data-stock-preview]");
if (packageSpec && stockPreview) {
  const refresh = () => quantityPreview(packageSpec, stockPreview);
  packageSpec.addEventListener("input", () => {
    if (packagePreset && packagePreset.value !== packageSpec.value) packagePreset.value = "";
    refresh();
  });
  packagePreset?.addEventListener("change", () => {
    if (packagePreset.value) packageSpec.value = packagePreset.value;
    else packageSpec.focus();
    refresh();
  });
  refresh();
}

const cycle = document.querySelector("[data-billing-cycle]");
const custom = document.querySelector("[data-custom-cycle]");
const customInput = custom?.querySelector("input");
if (cycle && custom && customInput) {
  const refresh = () => {
    const enabled = cycle.value === "custom";
    custom.hidden = !enabled;
    customInput.disabled = !enabled;
    customInput.required = enabled;
  };
  cycle.addEventListener("change", refresh);
  refresh();
}

const profilePicker = document.querySelector("[data-profile-picker]");
const profileFields = document.querySelector("[data-new-profile]");
if (profilePicker && profileFields) {
  const refresh = () => {
    const visible = profilePicker.value === "new";
    profileFields.hidden = !visible;
    profileFields.disabled = !visible;
  };
  profilePicker.addEventListener("change", refresh);
  refresh();
}

const localNow = new Date();
const pad = (number) => String(number).padStart(2,"0");
for (const element of document.querySelectorAll("[data-intake-zone]")) {
  element.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
}
const purchaseDate = document.querySelector("[data-purchase-date]");
const purchaseTime = document.querySelector("[data-purchase-time]");
if (purchaseDate && purchaseTime) {
  purchaseDate.value = `${localNow.getFullYear()}-${pad(localNow.getMonth()+1)}-${pad(localNow.getDate())}`;
  purchaseTime.value = `${pad(localNow.getHours())}:${pad(localNow.getMinutes())}`;
  const defaultDate=document.querySelector("[data-default-purchase-date]");
  const defaultTime=document.querySelector("[data-default-purchase-time]");
  if (defaultDate) defaultDate.value=purchaseDate.value;
  if (defaultTime) defaultTime.value=purchaseTime.value;
}

const audioFile = document.querySelector("[data-audio-file]");
const startRecording = document.querySelector("[data-start-recording]");
const stopRecording = document.querySelector("[data-stop-recording]");
const recordingStatus = document.querySelector("[data-recording-status]");
if (audioFile && startRecording && stopRecording && recordingStatus) {
  let recorder;
  let stream;
  let timer;
  startRecording.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof DataTransfer === "undefined") {
      recordingStatus.textContent="此浏览器可通过上方选择音频文件。";
      return;
    }
    startRecording.disabled=true;
    let chunks=[];
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      recorder=new MediaRecorder(stream);
      recorder.addEventListener("dataavailable",(event)=>{ if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("stop",()=>{
        clearTimeout(timer);
        stream.getTracks().forEach((track)=>track.stop());
        startRecording.disabled=false;
        stopRecording.disabled=true;
        if (!chunks.length) { recordingStatus.textContent="没有录到声音，请重新录制。"; return; }
        const type=recorder.mimeType||chunks[0].type;
        const extension=type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm";
        const files=new DataTransfer();
        files.items.add(new File(chunks,"food-recording."+extension,{type}));
        audioFile.files=files.files;
        recordingStatus.textContent="录音已就绪，点击「转写并提取」。";
        chunks=[];
      });
      recorder.start();
      stopRecording.disabled=false;
      recordingStatus.textContent="录音中…";
      timer=setTimeout(()=>{ if (recorder.state==="recording") recorder.stop(); },90000);
    } catch {
      stream?.getTracks().forEach((track)=>track.stop());
      startRecording.disabled=false;
      recordingStatus.textContent="无法使用麦克风，可以在上方选择音频文件。";
    }
  });
  stopRecording.addEventListener("click",()=>{ if (recorder?.state==="recording") recorder.stop(); });
}

const photoTypes = ["image/jpeg","image/png","image/webp","image/gif"];
async function preparePhoto(file) {
  if (photoTypes.includes(file.type) && file.size<=2*1024*1024) return file;
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=document.createElement("canvas");
    const ratio=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));
    canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve)=>canvas.toBlob(resolve,"image/jpeg",.82));
    if (!blob || blob.size>2*1024*1024) throw new Error();
    return new File([blob],"food-photo.jpg",{type:"image/jpeg"});
  } finally { bitmap.close(); }
}
for (const button of document.querySelectorAll("[data-intake-submit]")) {
  const form=button.form;
  let prepared=false;
  form?.addEventListener("submit",async (event)=>{
    const photoStatus=form.querySelector("[data-photo-status]");
    if (photoStatus && !prepared) {
      event.preventDefault();
      const inputs=[...form.querySelectorAll('input[name="photos"]')];
      const files=inputs.flatMap((input)=>[...input.files]);
      if (files.length<1 || files.length>4) { photoStatus.textContent="请选择 1 至 4 张照片。"; return; }
      button.disabled=true;
      photoStatus.textContent="正在准备照片…";
      try {
        for (const input of inputs) {
          const original=[...input.files];
          if (original.every((file)=>photoTypes.includes(file.type)&&file.size<=2*1024*1024)) continue;
          const data=new DataTransfer();
          for (const file of original) data.items.add(await preparePhoto(file));
          input.files=data.files;
        }
        prepared=true;
        form.requestSubmit();
      } catch {
        photoStatus.textContent="照片无法转换。请尝试不超过 2 MB 的 JPEG、PNG 或 WebP。";
        button.disabled=false;
      }
      return;
    }
    button.disabled=true;
    button.textContent="正在提取…";
  });
}

// Restore only short-lived UI state for an automatic GET filter navigation.
const filterStateKey = "lifecycle-filter-ui";
try {
  const raw = sessionStorage.getItem(filterStateKey);
  sessionStorage.removeItem(filterStateKey);
  const state = raw ? JSON.parse(raw) : null;
  if (state && state.url === location.href && Date.now() - state.time < 15000) {
    const form = document.querySelectorAll("form.filters, [data-wardrobe-filters]")[state.formIndex];
    const field = form?.elements.namedItem(state.name);
    if (field instanceof HTMLElement) {
      field.focus({preventScroll:true});
      if (typeof field.setSelectionRange === "function" && Number.isInteger(state.start)) {
        try { field.setSelectionRange(state.start,state.end); } catch {}
      }
    }
    window.scrollTo(state.x,state.y);
  }
} catch { /* Storage restrictions must not prevent filtering. */ }
// Reuse the existing GET filters, including all selected conditions.
for (const form of document.querySelectorAll("form.filters, [data-wardrobe-filters]")) {
  let timer;
  let composing = false;
  const submit = () => {
    clearTimeout(timer);
    if (!composing && form.checkValidity()) {
      try {
        const field = document.activeElement;
        const target = new URL(form.action || location.href);
        target.search = new URLSearchParams(new FormData(form)).toString();
        target.hash = "";
        sessionStorage.setItem(filterStateKey,JSON.stringify({
          url:target.href,time:Date.now(),x:window.scrollX,y:window.scrollY,
          formIndex:[...document.querySelectorAll("form.filters, [data-wardrobe-filters]")].indexOf(form),
          name:form.contains(field)?field.name:"",start:field?.selectionStart,end:field?.selectionEnd
        }));
      } catch { /* Native GET submission remains the fallback. */ }
      form.requestSubmit();
    }
  };
  form.addEventListener("submit", () => clearTimeout(timer));
  form.addEventListener("compositionstart", () => { composing = true; clearTimeout(timer); });
  form.addEventListener("compositionend", () => { composing = false; timer = setTimeout(submit, 900); });
  form.addEventListener("input", event => {
    clearTimeout(timer);
    if (!composing && event.target.matches('input:not([type=checkbox]):not([type=radio])')) timer = setTimeout(submit, 900);
  });
  form.addEventListener("change", event => {
    if (event.target.matches('select, input[type=checkbox], input[type=radio]')) submit();
  });
}


document.querySelectorAll("[data-food-expiry-mode]").forEach(select => {
  const prefix = select.name.slice(0, -"expiryMode".length);
  const form = select.form;
  const preview = document.createElement("p");
  preview.className = "food-muted";
  preview.setAttribute("role","status");
  select.closest("label").after(preview);
  const update = () => {
    const duration = select.value === "duration";
    for (const [field, visible] of [["expiresOn",select.value==="date"],["shelfLifeDays",duration],["shelfLifeBase",duration]]) {
      const input = form.elements.namedItem(prefix+field);
      if (!input || input instanceof RadioNodeList) continue;
      input.closest("label").hidden = !visible;
      input.disabled = !visible;
      input.required = visible && field==="shelfLifeDays";
    }
    const production = form.elements.namedItem(prefix+"producedOn");
    const purchased = form.elements.namedItem(prefix+"purchasedOn");
    const base = form.elements.namedItem(prefix+"shelfLifeBase");
    const baseValue = base instanceof RadioNodeList || !base ? "production" : base.value;
    if (production && !(production instanceof RadioNodeList)) production.required = duration && baseValue !== "purchase";
    const days=form.elements.namedItem(prefix+"shelfLifeDays");
    preview.textContent="";
    if(duration){
      const source = baseValue === "purchase" ? purchased : production;
      const date=new Date((source && !(source instanceof RadioNodeList) ? source.value : "")+"T12:00:00Z");
      const count=Number(days?.value);
      if(Number.isFinite(date.getTime()) && Number.isInteger(count) && count>0 && count<=36500){
        date.setUTCDate(date.getUTCDate()+count);
        preview.textContent="计算到期日期："+date.toISOString().slice(0,10);
      }else preview.textContent="填写"+(baseValue === "purchase" ? "购买日期" : "生产日期")+"和保质期后自动计算到期日期。";
    }
  };
  select.addEventListener("change",update);
  for (const field of ["producedOn","purchasedOn","shelfLifeBase","shelfLifeDays"]) {
    const input = form.elements.namedItem(prefix+field);
    if (input && !(input instanceof RadioNodeList)) input.addEventListener("input",update);
  }
  update();
});

document.querySelectorAll("[data-food-open-state]").forEach(select => {
  const input = select.form.querySelector("[data-food-open-date]");
  if (!input) return;
  const update = () => {
    const opened = select.value === "opened";
    input.closest("label").hidden = !opened;
    input.disabled = !opened;
    input.required = opened;
    if (opened && !input.value) {
      const now = new Date();
      input.value = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
    }
  };
  select.addEventListener("change",update);
  update();
});

const appNavigation = document.querySelector("#app-navigation");
const navigationTrigger = document.querySelector("[data-nav-open]");
if (appNavigation && navigationTrigger) {
  navigationTrigger.addEventListener("click", () => {
    if (!appNavigation.open) appNavigation.showModal();
    navigationTrigger.setAttribute("aria-expanded", "true");
  });
  document.querySelector("[data-nav-close]")?.addEventListener("click", () => appNavigation.close());
  appNavigation.addEventListener("click", event => {
    if (event.target !== appNavigation) return;
    const box = appNavigation.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) appNavigation.close();
  });
  appNavigation.addEventListener("close", () => {
    navigationTrigger.setAttribute("aria-expanded", "false");
    navigationTrigger.focus();
  });
  appNavigation.querySelectorAll("nav a").forEach(anchor => {
    if (anchor.pathname === "/" ? location.pathname === "/" : location.pathname.startsWith(anchor.pathname)) anchor.setAttribute("aria-current", "page");
  });
}

// Home module picker uses the same native modal behavior as the navigation.
const quickDialog = document.querySelector('#quick-entry');
const quickTrigger = document.querySelector('[data-quick-open]');
if (quickDialog && quickTrigger) {
  quickTrigger.addEventListener('click', () => quickDialog.showModal());
  document.querySelector('[data-quick-close]')?.addEventListener('click', () => quickDialog.close());
  quickDialog.addEventListener('click', event => {
    const box = quickDialog.getBoundingClientRect();
    if (event.target === quickDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) quickDialog.close();
  });
  quickDialog.addEventListener('close', () => quickTrigger.focus());
}
