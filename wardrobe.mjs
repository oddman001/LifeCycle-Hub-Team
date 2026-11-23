const wardrobeChoices = {kind:["上衣","裤装","裙装","外套","鞋靴","配饰","其他"],frequency:["经常穿","偶尔穿","很少穿","未穿过"]};
function wardrobeSelect(key,label,value="") {
  const choices=[...new Set([...wardrobeChoices[key],...(value?[value]:[])])];
  return '<label>'+label+'<select name="'+key+'"><option value="">请选择</option>'+choices.map(choice=>'<option '+(choice===value?"selected":"")+'>'+escape(choice)+'</option>').join("")+'</select></label>';
}
const wardrobeFields = {kind:"类别",brand:"品牌",size:"尺码",color:"颜色",material:"材质（逗号分隔）",frequency:"穿着频率",weather:"适用天气（逗号分隔）",care:"洗护标签（逗号分隔）",location:"存放位置",price:"购买价格（元，可选）"};
const wardrobeTags = {
  material:["棉","羊毛","聚酯纤维","真丝","亚麻"],
  weather:["晴天","雨天","阴天","雪天","大风"],
  care:["可机洗","轻柔手洗","需要干洗","阴干","低温熨烫","不可漂白"],
};
const wardrobeSplit = (value) => [...new Set(String(value || "").split(/[,，、]/).map(s => s.trim()).filter(Boolean))];
function wardrobeDate(raw, reference, confirmedYear = "") {
  const text = raw.trim().normalize("NFKC");
  if (!text) return null;
  const result = (value, precision, estimated = false) => ({raw:raw.trim(),value,precision,estimated,reference});
  const clean = text.replace(/(?:购买|购入|买的|买了)$/, "");
  const exact = clean.match(/^(\d{4})(?:年|-)(\d{1,2})(?:月|-)(\d{1,2})日?$/);
  if (exact) {
    const value = exact[1]+"-"+exact[2].padStart(2,"0")+"-"+exact[3].padStart(2,"0");
    const date = new Date(value);
    if (exact[1] === "0000" || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw Error("购买日期无效");
    if (value > reference) throw Error("购买时间不能晚于今天");
    return result(value,"day");
  }
  const month = clean.match(/^(\d{4})(?:年|-)(\d{1,2})月?$/);
  if (month && month[1] !== "0000" && Number(month[2]) >= 1 && Number(month[2]) <= 12) {
    const value = month[1]+"-"+month[2].padStart(2,"0");
    if (value > reference.slice(0,7)) throw Error("购买时间不能晚于本月");
    return result(value,"month");
  }
  const year = clean.match(/^(\d{4})年?$/);
  if (year && year[1] !== "0000") {
    if (year[1] > reference.slice(0,4)) throw Error("购买时间不能晚于今年");
    return result(year[1],"year");
  }
  if (month || year) throw Error("购买时间格式无效");
  if (confirmedYear) {
    if (!/^\d{4}$/.test(confirmedYear) || Number(confirmedYear) < 1 || confirmedYear > reference.slice(0,4)) throw Error("请确认有效的购买年份");
    return result(confirmedYear,"year",true);
  }
  const numbers = {一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
  const count = value => /^\d/.test(value) ? Number(value) : numbers[value];
  const relative = clean.replace(/^买了/, "").match(/^([一二两三四五六七八九十\d]+)(年半|年|个月|月)(?:前)?$/);
  const range = clean.match(/^([一二两三四五六七八九十])([一二两三四五六七八九十])年前$/);
  let months;
  if (range && count(range[1]) < count(range[2])) months = (count(range[1])+count(range[2]))*6;
  else if (relative) months = count(relative[1])*(relative[2].startsWith("年") ? 12 : 1)+(relative[2] === "年半" ? 6 : 0);
  if (!Number.isFinite(months) || months < 0 || months > 1200) throw Error("请确认大致购买时间，可填日期、年月、年份或两年前。含糊的节日请补充年份。");
  const date = new Date(reference+"T12:00:00Z");
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth()-months);
  if (date.getUTCFullYear() < 1) throw Error("购买时间超出支持范围");
  return result(date.toISOString().slice(0,7),"estimate",true);
}
function wardrobeAge(date) {
  if (!date?.value) return "购买时间未填写";
  const now = new Date();
  if (date.precision === "year") return date.raw+" · 约 "+Math.max(0,now.getFullYear()-Number(date.value))+" 年";
  const months = Math.max(0,(now.getFullYear()-Number(date.value.slice(0,4)))*12+now.getMonth()-(Number(date.value.slice(5,7))-1));
  return date.raw+" · 约 "+Math.floor(months/12)+" 年 "+months%12+" 个月";
}
function wardrobeData(row) {
  let saved = {};
  try { saved = JSON.parse(row.wardrobe || "{}") || {}; } catch {}
  return {...saved,
    material:saved.material ?? row.material,
    frequency:saved.frequency ?? row.frequency,
    purchase:Object.hasOwn(saved,"purchase") ? saved.purchase : row.purchasedOn ? {raw:row.purchasedOn,value:row.purchasedOn,precision:"day"} : null,
  };
}
function wardrobeTagEditor(key, value) {
  const selected = wardrobeSplit(value);
  const choices = [...new Set([...wardrobeTags[key],...selected])];
  return '<fieldset class="wardrobe-tags"><legend>'+escape(wardrobeFields[key].replace('（逗号分隔）',''))+'</legend>'+
    choices.map(tag => '<label><input type="checkbox" name="'+key+'" value="'+escape(tag)+'" '+(selected.includes(tag)?"checked":"")+'>'+escape(tag)+'</label>').join("")+
    '<label>补充标签（逗号分隔）<input name="'+key+'Custom" maxlength="240"></label></fieldset>';
}
async function wardrobeRoute(request,env,url) {
  const db=env.DB;
  const root="/items/clothing";
  const part=url.pathname.slice(root.length).split("/").filter(Boolean);
  if(part.length>1)return render(hero("找不到档案",backLink(root,"返回衣橱")),404);
  const id=part[0];
  const all=(await db.prepare("SELECT i.*,c.* FROM Item i JOIN ClothingDetail c ON c.itemId=i.id WHERE i.category='clothing' AND i.deletedAt IS NULL").all()).results;
  const row=all.find(r=>r.id===id);
  const input=(name,label,value="",type="text")=>'<label>'+label+'<input name="'+name+'" type="'+type+'" maxlength="240" value="'+escape(value)+'"></label>';
  function page(item={},data={},message="",review=false,reviewSource="",reviewFallback="") {
    return render(hero(item.name?escape(item.name):"新增衣物",backLink(root,"返回衣橱"),!item.id?moduleEntry(root+"/new?mode=quick",root+"/new?mode=manual",review?"quick":"manual"):"")+
      (message?'<p role="alert">'+escape(message)+'</p>':"")+
      (review?'<p class="notice" role="status">'+((reviewSource==="ai")?"AI 识别结果":"文字规则提取结果")+'，请核对后选择购买时间保存。'+(reviewFallback?"（AI 识别暂时失败，已改用本地规则。）":"")+'</p>':"")+
      (item.id?'<p>'+escape(wardrobeAge(data.purchase))+'</p>':"")+
      '<form method="post" action="/items/clothing/'+(item.id||"new")+'" class="panel editor wardrobe-editor component-form"><fieldset>'+input("name","衣物名称",item.name)+wardrobeTimeEditor(data.purchase,review || Boolean(data.purchase?.precision && data.purchase.precision!=="day"))+
      Object.entries(wardrobeFields).map(([key,label])=>wardrobeTags[key] ? wardrobeTagEditor(key,data[key]) : wardrobeChoices[key] ? wardrobeSelect(key,label,data[key]) : input(key,label,data[key])).join("")+
      input("minTemp","最低适用温度 °C",data.minTemp,"number")+input("maxTemp","最高适用温度 °C",data.maxTemp,"number")+
      '<label>备注<textarea name="notes" maxlength="2000">'+escape(item.notes)+'</textarea></label></fieldset><div class="food-toolbar"><button class="btn btn-primary">保存衣物</button>'+entryButton(root,"取消","secondary")+'</div></form>'+
      (item.id?'<form method="post"><button class="button secondary" name="operation" value="'+(item.archivedAt?'restore':'archive')+'">'+(item.archivedAt?'恢复归档':'归档')+'</button></form>'+deleteControl("档案",item.name):""),message&&!review?400:200);
  }
  if(id&&id!=="new"&&id!=="intake"&&!row)return render(hero("找不到档案",backLink(root,"返回衣橱")),404);
  if(request.method==="POST"){
    if(request.headers.get("origin")!==url.origin)return new Response("请求来源无效",{status:403});
    if(!id)return new Response(null,{status:405});
    const form=await request.formData(),get=k=>String(form.get(k)||"").trim();
    const now=new Date().toISOString(),operation=get("operation");
    if (id==="intake") {
      try {
        const extracted=await wardrobeIntakeExtract(env,get("text"));
        return page(extracted.item,extracted.data,"",true,extracted.source,extracted.fallback);
      } catch(error) { return render(hero("快速录入","")+ '<p role="alert">'+escape(error.message)+'</p>'+link(root+"/new","重新录入"),400); }
    }

    if(row&&operation==="delete"){await deleteItem(db,id,"clothing");return foodRedirect(root);}
    if(row&&["archive","restore"].includes(operation)){
      await db.batch([db.prepare("UPDATE Item SET archivedAt=?,updatedAt=? WHERE id=?").bind(operation==="archive"?now:null,now,id),
        foodEvent(db,id,operation,now)]);
      return foodRedirect(root);
    }
    const data=Object.fromEntries(Object.keys(wardrobeFields).map(k=>[k,wardrobeTags[k] ? wardrobeSplit([...form.getAll(k),get(k+"Custom")].join(",")).join("，") : get(k)]));
    const item={...row,name:get("name"),notes:get("notes")};
    let purchaseInput = "";
    try{
      if (data.price && !/^\d{1,7}(?:\.\d{1,2})?$/.test(data.price)) throw Error("购买价格应为非负金额，最多两位小数");
      purchaseInput=wardrobeTimeFromForm(form);
      const prior=row?wardrobeData(row):{};
      data.purchase=prior.purchase?.raw===purchaseInput && (!get("confirmedYear") || get("confirmedYear")===prior.purchase.value)?prior.purchase:wardrobeDate(purchaseInput,intakeClock(Intl.DateTimeFormat().resolvedOptions().timeZone).day,get("confirmedYear"));
      for(const key of ["minTemp","maxTemp"]) {
        data[key]=get(key)===""?null:Number(get(key));
        if(data[key]!==null&&(!Number.isFinite(data[key])||data[key]<-100||data[key]>100))throw Error("温度应在 -100 至 100 之间");
      }
      if(data.minTemp!==null&&data.maxTemp!==null&&data.minTemp>data.maxTemp)throw Error("最低温度不能大于最高温度");
      if(!item.name||item.name.length>120||item.notes.length>2000||Object.keys(wardrobeFields).some(k=>data[k].length>240))throw Error("请检查名称和字段长度");
      const recordId=row?id:crypto.randomUUID();
      await db.batch([
        row?db.prepare("UPDATE Item SET name=?,notes=?,updatedAt=? WHERE id=?").bind(item.name,item.notes,now,id):
          db.prepare("INSERT INTO Item(id,name,category,notes,updatedAt) VALUES(?,?,'clothing',?,?)").bind(recordId,item.name,item.notes,now),
        db.prepare("INSERT INTO ClothingDetail(itemId,material,frequency,wardrobe,purchasedOn) VALUES(?,?,?,?,?) ON CONFLICT(itemId) DO UPDATE SET material=excluded.material,frequency=excluded.frequency,wardrobe=excluded.wardrobe,purchasedOn=excluded.purchasedOn").bind(recordId,data.material,data.frequency,JSON.stringify(data),data.purchase?.precision==="day"?data.purchase.value:null)
      ]);
      return foodRedirect(root+"/"+recordId);
    }catch(error){return page(item,{...data,purchase:{raw:purchaseInput}},error.message);}
  }
  if(id==="new"&&request.method==="GET"&&!["quick","manual"].includes(url.searchParams.get("mode"))) {
    return render(hero("添加衣物",backLink(root,"返回衣橱"))+
      '<div class="intake-grid wardrobe-entry">'+link(root+'/new?mode=quick','<h2>快速录入</h2><p>输入衣物信息，提取后核对保存。</p>',"panel wardrobe-card")+
      link(root+'/new?mode=manual','<h2>手动录入</h2><p>选择标签和购买日期。</p>',"panel wardrobe-card")+'</div>');
  }
  if(id==="new"&&url.searchParams.get("mode")==="quick") {
    return render(hero("快速录入",backLink(root,"返回衣橱"),moduleEntry(root+"/new?mode=quick",root+"/new?mode=manual","quick"))+
      (intakeConfigured(env)?`<p class="notice">已启用 AI 识别（${escape(intakeLabel(env))}），调用失败时自动改用本地规则。识别结果需核对后才会保存。</p>`:'<p class="notice">未配置 AI 识别，本次使用本地文字规则提取。识别结果需核对后才会保存。</p>')+
      '<form class="panel wardrobe-editor component-form" action="'+root+'/intake" method="post"><label>描述衣物<textarea name="text" rows="4" maxlength="2000" required placeholder="两年前买了一件羊毛外套，花了399元，经常穿，需要干洗。"></textarea></label><div class="food-toolbar"><button class="btn btn-primary">提取信息</button>'+entryButton(root,"取消","secondary")+'</div></form>');
  }
  if(id)return page(row||{},row?wardrobeData(row):{});
  const q=url.searchParams.get("q")||"",archived=url.searchParams.get("status")==="archived";
  const rows=all.filter(r=>{
    if(Boolean(r.archivedAt)!==archived||!r.name.toLowerCase().includes(q.toLowerCase()))return false;
    const d=wardrobeData(r);
    return ["kind","material","frequency","weather","care"].every(k=>!url.searchParams.get(k)||wardrobeSplit(url.searchParams.get(k)).every(tag=>wardrobeSplit(d[k]).includes(tag)))&&
      (!url.searchParams.get("temperature") || (d.minTemp!=null||d.maxTemp!=null)&&Number(url.searchParams.get("temperature"))>=(d.minTemp??-Infinity)&&Number(url.searchParams.get("temperature"))<=(d.maxTemp??Infinity));
  });
  if(url.searchParams.get("sort")==="purchase")rows.sort((a,b)=>(wardrobeData(b).purchase?.value||"").localeCompare(wardrobeData(a).purchase?.value||""));
  else rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  return render(hero("我的衣橱","衣物、购买时长与洗护标签",moduleEntry(root+"/new?mode=quick",root+"/new?mode=manual"))+
    '<form class="panel editor wardrobe-filters" data-wardrobe-filters><fieldset>'+input("q","名称搜索",q)+'<details class="wide wardrobe-more"'+(["kind","material","frequency","weather","care","temperature"].some(k=>url.searchParams.get(k))?' open':'')+'><summary>更多筛选</summary><div class="wardrobe-filter-grid">'+["kind","material","frequency","weather","care"].map(k=>input(k,wardrobeFields[k],url.searchParams.get(k))).join("")+input("temperature","适用温度 °C",url.searchParams.get("temperature"),"number")+'</div></details>'+
    '<label>状态<select name="status"><option value="active">在用</option><option value="archived" '+(archived?"selected":"")+'>已归档</option></select></label><label>排序<select name="sort"><option value="updated">最近更新</option><option value="purchase" '+(url.searchParams.get("sort")==="purchase"?"selected":"")+'>购买时间</option></select></label></fieldset><button class="button">筛选</button></form>'+
    filterSummary(rows.length,root,url.searchParams)+'<div class="intake-grid wardrobe-grid">'+rows.map(r=>{const d=wardrobeData(r);return link(root+"/"+r.id,'<div class="wardrobe-placeholder" aria-label="衣物占位图">◇</div><h2>'+escape(r.name)+'</h2><p>'+escape(wardrobeAge(d.purchase))+'</p><p>'+escape([d.kind,d.material,d.frequency,d.care].filter(Boolean).join(" · "))+'</p><p>温度 '+escape(d.minTemp??"未标记")+" ～ "+escape(d.maxTemp??"未标记")+' °C · '+escape(d.weather||"天气未标记")+'</p><span class="wardrobe-card-action">查看与编辑 →</span>',"panel wardrobe-card");}).join("")+(rows.length ? "" : emptyInventory(all.some(r=>Boolean(r.archivedAt)===archived)?'无匹配结果。':archived?'暂无已归档衣物记录。':'暂无衣物记录。',root,'添加衣物',all.some(r=>Boolean(r.archivedAt)===archived)?'请调整或清除筛选条件后重试。':'可添加衣物；品牌、材质及洗护信息可稍后补充。'))+'</div>');
}
