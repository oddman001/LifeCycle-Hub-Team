const intakeLabels={purchase:"登记采购",adjust:"调整剩余量",move:"转移位置",open:"标记开封",consume:"记录部分消耗",consumeAll:"标记吃完",query:"查询库存"};
const intakeNameKey=(text)=>String(text??"").normalize("NFKC").toLowerCase().replace(/\s+/g,"");
const intakeProfileKey=(item)=>[item.name,item.brand,item.specification].map(intakeNameKey).join("|");
const intakeOwner=(request)=>request.headers.get("oai-authenticated-user-id") || "private-site";
const intakeHidden=(name,value)=>`<input type="hidden" name="${name}" value="${escape(value)}">`;
const intakeQuantityPattern="([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十]+)\\s*(" + foodQuantityUnit + ")";
function intakeReadQuantity(clause,prefix) {
  const match=clause.match(new RegExp(prefix+"\\s*"+intakeQuantityPattern));
  if (!match) return null;
  const amount=/^\d/.test(match[1])?Number(match[1]):numberOf(match[1]);
  return Number.isFinite(amount)?{amount,unit:match[2]}:null;
}
function intakePurchaseFollowup(line) {
  const clauses=line.split(/[，,、]/).map((part)=>part.trim());
  const consumed=clauses.map((part)=>intakeReadQuantity(part,"(?:吃了|喝了|用掉了?|消耗了?)")).filter(Boolean);
  const initial=clauses.map((part)=>intakeReadQuantity(part,"^(?:(?:一共|总共|共有|有|共|里面有)\\s*)?"))
    .slice(1).find((value,index)=>value && !/吃|喝|剩|过期|到期|保质/.test(clauses[index+1]));
  const all=clauses.some((part)=>/吃完了|喝完了|全部消耗/.test(part));
  const hasConsumption=all||consumed.length>0||clauses.some((part)=>/吃了|喝了|用了|用掉|消耗/.test(part));
  if (!hasConsumption) return {};
  const units=new Set(consumed.map((item)=>item.unit));
  return {
    followup:all?"all":"partial",
    initialAmount:initial?.amount??null,initialUnit:initial?.unit??"",
    consumedAmount:units.size===1?consumed.reduce((sum,item)=>sum+item.amount,0):null,
    consumedUnit:units.size===1?consumed[0].unit:"",
  };
}
function intakeLocation(line,locations) {
  const explicit=[...locations].sort((a,b)=>b.name.length-a.name.length).find((row)=>line.includes(row.name));
  if (explicit) return explicit.id;
  if (line.includes("冷冻")) return locations.find((r)=>r.id==="freezer")?.id || "";
  if (line.includes("冷藏")) return locations.find((r)=>r.id==="fridge")?.id || "";
  if (/(?:放在|放进|放入|放到|放|储存在)\s*(?:厨房(?:的)?)?(?:柜子|储物柜)(?:里|内|中)?(?:了|[，,。；;]|$)/.test(line)) {
    return locations.find((r)=>r.id==="cupboard")?.id || "";
  }
  return "";
}
function intakeRuleRows(text,locations,clock) {
  const rows=foodTextCandidates(text,locations,clock.day).map((row)=>{
    const line=row.source;
    const isPurchase=foodPurchaseLead.test(intakeCleanSpeech(line)) || foodPurchaseVerb.test(line);
    const count=line.match(/(?:改成|改为|减少|吃了|喝了)\s*([\d.]+|[一二两三四五六七八九十]+)\s*(千克|公斤|毫升|斤|克|升|个|盒|袋|瓶|罐)/);
    const amount=count?(/^[0-9]/.test(count[1])?Number(count[1]):numberOf(count[1])):row.amount;
    const place=intakeLocation(line,locations);
    const parsed=line.match(/^(?:把)?(?:冰箱里的?|这袋|这盒|这瓶)?(.+?)(?:的?(?:剩余)?数量改[成为]|(?:刚刚|刚|已经|已)?(?:开封|吃完|喝完)|移到|转移到|放到|吃了|喝了)/);
    if (parsed && !isPurchase) {
      const intent=/改[成为]/.test(line)?"adjust":/吃完|喝完/.test(line)?"consumeAll":
        /开封/.test(line)?"open":/吃了|喝了/.test(line)?"consume":"move";
      // 口语里会先交代原来的位置（"把番茄炒蛋从厨房储物柜移到冰箱冷藏室"），
      // 名称只取来源位置之前的部分，目标位置也以"移到/放到"之后的地点为准。
      const moveTarget=line.match(/(?:移到|转移到|搬到|放到|放进|放入)(.+)$/);
      const moved=intent==="move"&&moveTarget?intakeLocation(moveTarget[1],locations):"";
      return {intent,name:parsed[1].replace(/\s*从.*$/,"").trim(),amount:Number.isFinite(amount)?amount:null,unit:count?.[2]||"",locationId:moved||place};
    }
    if (!isPurchase && /还有多少|查(?:看|询)|还剩多少/.test(line)) {
      return {intent:"query",name:line.replace(/^(查看|查询|冰箱里有)/,"").replace(/还有多少.*$|还剩多少.*$/,"").trim(),locationId:place};
    }
    const portions=line.match(/(?:[，,])\s*([一二两三四五六七八九十\d]+)(袋|盒|瓶|包)(?:放)?冷冻[，,]\s*([一二两三四五六七八九十\d]+)(袋|盒|瓶|包)(?:放)?冷藏/);
    const base={intent:"purchase",name:row.name,amount:Number.isFinite(row.amount)?row.amount:null,unit:row.unit,
      purchasedOn:row.purchase,locationId:place,shortLife:/牛奶|酸奶|鲜肉|鸡胸肉|熟食|剩菜/.test(row.name),
      sourceText:line,...(isPurchase?intakePurchaseFollowup(line):{})};
    if (portions) return [{...base,amount:numberOf(portions[1]),unit:portions[2],locationId:"freezer"},
      {...base,amount:numberOf(portions[3]),unit:portions[4],locationId:"fridge"}];
    return base;
  });
  return rows.flat().slice(0,8);
}
function intakeMergePurchases(extracted,text,locations,clock) {
  if (!text) return extracted;
  const rules=intakeRuleRows(text,locations,clock);
  const compounds=rules.filter((row)=>row.intent==="purchase"&&row.followup);
  if (!compounds.length) return extracted;
  const related=(rule,row)=>{
    const sameMove=row.intent==="move"&&rule.locationId&&
      (row.locationId===rule.locationId||(row.sourceText&&rule.sourceText.includes(row.sourceText)));
    if (!["purchase","consume","consumeAll"].includes(row.intent)&&!sameMove) return false;
    const name=intakeNameKey(rule.name),other=intakeNameKey(row.name);
    return Boolean(name && (name===other || (row.sourceText===rule.sourceText&&other.includes(name))));
  };
  const affected=rules.filter((rule)=>rule.intent==="purchase"&&compounds.some((compound)=>related(compound,rule)));
  const replacements=affected.map((rule)=>{
    const purchase=extracted.find((row)=>row.intent==="purchase"&&related(rule,row)&&
      (row.sourceText===rule.sourceText||affected.filter((r)=>related(r,row)).length===1));
    return {...purchase,...rule,locationId:rule.locationId||purchase?.locationId||""};
  });
  return [...extracted.filter((row)=>!compounds.some((rule)=>related(rule,row))),...replacements].slice(0,8);
}
function intakeMatch(candidate,profiles) {
  const name=intakeNameKey(candidate.name);
  if (!name) return {preferred:"",options:[]};
  const brand=intakeNameKey(candidate.brand), spec=intakeNameKey(candidate.specification);
  const candidates=profiles.filter((profile)=>{
    const pName=intakeNameKey(profile.name);
    return pName && (pName===name || (Math.min(pName.length,name.length)>=2 && (pName.includes(name)||name.includes(pName)))) &&
      (!brand || !profile.brand || intakeNameKey(profile.brand)===brand) &&
      (!spec || !profile.specification || intakeNameKey(profile.specification)===spec);
  });
  const precise=candidates.filter((profile)=>intakeProfileKey(profile)===intakeProfileKey(candidate));
  return {preferred:precise.length===1?precise[0].id:"",options:candidates.slice(0,12)};
}
function intakeEntry(hasAI, message="", status=200, context={}) {
  const media=hasAI&&context.media===true;
  const title=context.title||foodBack("快速记录","输入一句话，核对后保存。",moduleEntry(foodRoot+"/intake",foodRoot+"/new","quick"));
  const cancelHref=context.cancelHref||foodRoot;
  const placeholder=context.placeholder||"昨天买了两斤苹果，放在冰箱冷藏室";
  const tz='<input type="hidden" name="timeZone" data-intake-zone value="Asia/Shanghai">';
  const form=(method,content,button)=>`<form class="panel editor component-form" method="post" enctype="multipart/form-data">
    ${intakeHidden("method",method)}${tz}<fieldset>${content}</fieldset><div class="food-toolbar"><button class="btn btn-primary" data-intake-submit>${button}</button>${entryButton(cancelHref,"取消","secondary")}</div></form>`;
  return render(title+(message?`<p class="notice error" role="alert">${escape(message)}</p>`:"")+
    (!hasAI?'<p class="notice">AI 服务未配置。可以使用文字规则提取或手动录入。</p>':
      media?"":`<p class="notice">已启用文字 AI 识别${context.label?`（${escape(context.label)}）`:""}；照片和语音识别需要另行开启。</p>`)+
    `<section><div class="section-heading"><h2>文字</h2></div>${form("text",
      `<label class="wide">描述采购或库存变化<textarea name="text" rows="4" maxlength="3000" placeholder="${escape(placeholder)}" required></textarea></label>`,
      "提取信息")}</section>
    <div class="food-edit-grid"><section><div class="section-heading"><h2>拍照</h2></div>
      ${media?form("photo",'<label class="wide">用手机拍摄<input name="photos" type="file" accept="image/*" capture="environment"></label><label class="wide">或选择包装和标签照片<input name="photos" type="file" accept="image/*" multiple></label><p class="wide food-muted">最多 4 张。较大照片会在设备上尽量压缩至 2 MB。图片将发送到 OpenAI 识别。</p><small class="wide" data-photo-status role="status"></small>',"识别照片"):`<p>${hasAI?'当前只识别文字描述，照片识别未开启。':'配置 AI 服务并设置 AI_MEDIA=1 后可拍摄和上传照片。'}</p>`}</section>
    <section><div class="section-heading"><h2>语音</h2></div>
      ${media?form("voice",'<label class="wide">录音或选择音频文件<input name="audio" data-audio-file type="file" accept="audio/*,.webm,.m4a,.mp4" required></label><div class="wide food-toolbar"><button class="button secondary" type="button" data-start-recording>开始录音</button><button class="button secondary" type="button" data-stop-recording disabled>停止录音</button><small data-recording-status role="status">最长 90 秒</small></div><p class="wide food-muted">音频不超过 10 MB，将发送到 OpenAI 转写。</p>',"转写并提取"):`<p>${hasAI?'当前只识别文字描述，语音识别未开启。':'配置 AI 服务并设置 AI_MEDIA=1 后可录音和上传音频。'}</p>`}</section></div>`,status);
}
function intakeNormalize(candidate,{locations,categories,clock}) {
  const suggested=Boolean(candidate.shortLife || /牛奶|酸奶|鲜肉|鸡胸肉|熟食|剩菜/.test(candidate.name));
  const systemDate=!foodDate(candidate.purchasedOn);
  const systemTime=!candidate.purchaseTime && (systemDate || candidate.purchasedOn===clock.day);
  const purchaseDate=systemDate?clock.day:candidate.purchasedOn;
  const base=candidate.shelfLifeBase==="purchase" ? purchaseDate : candidate.producedOn;
  const computed=candidate.shelfLifeBase&&candidate.shelfLifeDays&&foodDate(base)?foodAddDays(base,candidate.shelfLifeDays):"";
  const explicit=foodDate(candidate.expiresOn);
  const missingBase=candidate.shelfLifeBase&&!computed&&!explicit;
  return {...candidate,purchasedOn:purchaseDate,
    purchaseTime:systemTime?clock.time:(candidate.purchaseTime||""),
    producedOn:foodDate(candidate.producedOn)?candidate.producedOn:"",
    expiresOn:explicit?candidate.expiresOn:foodDate(computed)?computed:"",
    expirySource:explicit?candidate.expirySource:computed?"shelf":"",
    shelfLifeBase:explicit?"":candidate.shelfLifeDays?(candidate.shelfLifeBase==="purchase"?"purchase":"production"):"",
    dateEvidence:missingBase?[candidate.dateEvidence,"请补充生产日期，系统会自动计算到期日期。"].filter(Boolean).join(" "):candidate.dateEvidence,
    locationId:locations.some((r)=>r.id===candidate.locationId)?candidate.locationId:"unassigned",
    categoryId:categories.some((r)=>r.id===candidate.categoryId)?candidate.categoryId:"",
    systemDate,systemTime,shortLife:suggested};
}
function intakeResolveDates(candidate,text,all,clock,method) {
  if (method==="photo") return candidate.dateEvidence
    ? {...candidate,expirySource:"label"}
    : {...candidate,producedOn:"",expiresOn:"",dateEvidence:"包装日期需要核对"};
  const sections=text.split(/[；;。\n！!？?]/).map((part)=>part.trim()).filter(Boolean);
  const name=intakeNameKey(candidate.name);
  const matching=sections.filter((part)=>name&&intakeNameKey(part).includes(name));
  const excerpt=candidate.sourceText;
  const purchases=all.filter((r)=>r.intent==="purchase");
  const source=all.length===1 ? text
    : excerpt&&text.includes(excerpt)&&name&&intakeNameKey(excerpt).includes(name) ? excerpt
    : matching.length===1&&purchases.filter((r)=>intakeNameKey(r.name)===name).length===1 ? matching[0] : "";
  const parsed=resolveFoodDates(source,clock.day);
  if (!source && /到期|过期|保质期/.test(text)) parsed.dateEvidence="无法确定日期对应哪个食品，请逐条核对。";
  // Keep values the model already extracted when the sentence cannot be matched back to a food
  // name; otherwise an unattributed sentence would erase a stated expiry date or shelf life.
  return {...candidate,
    expiresOn:parsed.expiresOn||candidate.expiresOn||"",
    expirySource:parsed.expirySource||candidate.expirySource||"",
    shelfLifeDays:parsed.shelfLifeDays??candidate.shelfLifeDays??null,
    shelfLifeBase:parsed.shelfLifeBase||candidate.shelfLifeBase||"",
    producedOn:parsed.producedOn||candidate.producedOn||"",
    dateEvidence:[parsed.dateEvidence,candidate.dateEvidence].filter(Boolean).join(" ")};
}
function intakeBatchOptions(candidate,rows) {
  const name=intakeNameKey(candidate.name);
  return rows.filter((r)=>foodActive(r) && (!name || intakeNameKey(foodTitle(r)).includes(name) || name.includes(intakeNameKey(foodTitle(r)))))
    .slice(0,20);
}

function intakeFollowupFields(candidate,key) {
  if (!candidate.followup) return "";
  const stock=candidate.initialAmount!=null
    ? {amount:candidate.initialAmount,unit:candidate.initialUnit}
    : candidate.followup==="all"||candidate.unit===candidate.consumedUnit
      ? {amount:candidate.amount,unit:candidate.unit} : {amount:null,unit:candidate.consumedUnit};
  const comparable=stock.amount!=null&&stock.unit&&stock.unit===candidate.consumedUnit&&
    candidate.consumedAmount!=null&&stock.amount>=candidate.consumedAmount;
  const message=candidate.followup==="all"?"创建新批次后记录全部消耗。":
    comparable?`按当前识别值预计剩余 ${stock.amount-candidate.consumedAmount} ${stock.unit}。`:
      "购买单位和消耗单位无法直接换算，或数量不完整。请确认消耗前的数量，并用同一单位填写消耗量。";
  return `<div class="wide"><strong>本次购买后的库存操作</strong><p>${escape(message)}</p></div>`+
    foodInput(key("initialAmount"),"消耗前数量",stock.amount,foodNumberAttrs+(candidate.followup==="partial"?" required":""))+
    foodInput(key("initialUnit"),"库存单位",stock.unit,'maxlength="20"'+(candidate.followup==="partial"?" required":""))+
    (candidate.followup==="partial"?
      foodInput(key("consumedAmount"),"已消耗数量",candidate.consumedAmount,foodNumberAttrs+" required")+
      foodInput(key("consumedUnit"),"消耗单位",candidate.consumedUnit,'maxlength="20" required'):"");
}

function intakeReview(draft,candidates,profiles,locations,categories,rows,transcript) {
  const title=foodBack("核对快速记录","核对档案匹配、购买时间、数量与存放位置。");
  const purchases=[];
  const actions=[];
  for (const [index,c] of candidates.entries()) {
    const key=(field)=>`candidate-${index}-${field}`;
    if (c.intent==="purchase") {
      const match=intakeMatch(c,profiles);
      const matching=match.options.length
        ? foodDropdown(key("foodId"),"档案匹配",
          (!match.preferred?'<option value="" disabled selected>请选择档案</option>':"")+
          match.options.map((p)=>foodOption(p.id,[p.name,p.brand,p.specification].filter(Boolean).join(" · "),match.preferred)).join("")+
          foodOption("new","新建档案",match.preferred),"required")
        : intakeHidden(key("foodId"),"new");
      const expiry=foodInput(key("expiresOn"),"到期日期",c.expiresOn,'type="date"');
      const duration=foodShelfFields(key,c);
      purchases.push(`<fieldset class="panel editor component-form"><legend>待确认 · ${index+1}</legend>
        <p class="wide food-muted">${match.preferred?"已匹配同名、同品牌和规格的档案。":match.options.length?"有相似档案，请确认匹配对象。":"将生成新食品档案与本次独立批次。"}</p>
        ${matching}
        ${foodInput(key("name"),"食品名称",c.name,'required maxlength="120"')}
        ${foodInput(key("purchasedAmount"),c.followup?"购买数量或重量":"数量",c.amount,foodNumberAttrs)}
        ${foodInput(key("unit"),c.followup?"购买单位":"单位",c.unit,'maxlength="20"')}
        ${intakeFollowupFields(c,key)}
        ${foodDropdown(key("locationId"),"储存位置",foodOptions(locations,c.locationId))}
        ${foodInput(key("purchasedOn"),"购买日期",c.purchasedOn,'type="date"')}
        ${foodInput(key("purchaseTime"),"购买时间",c.purchaseTime,'type="time"')}
        ${(c.shortLife||c.expiresOn||c.shelfLifeDays||c.dateEvidence)?expiry:""}
        ${c.shelfLifeDays?duration:""}
        ${foodInput(key("producedOn"),"生产日期",c.producedOn,'type="date"')}
        <details class="wide intake-more"><summary>其他资料${c.brand||c.specification?" · "+escape([c.brand,c.specification].filter(Boolean).join(" · ")):""}</summary>
        <div>
          ${foodInput(key("brand"),"品牌",c.brand,'maxlength="120"')}
          ${foodDropdown(key("categoryId"),"分类",foodCategoryOptions(categories,c.categoryId))}
          ${foodInput(key("specification"),"规格",c.specification,'maxlength="240"')}

          ${(!c.shortLife&&!c.expiresOn&&!c.shelfLifeDays&&!c.dateEvidence)?expiry:""}
          ${!c.shelfLifeDays?duration:""}
          ${foodInput(key("amountNote"),"模糊数量",c.amountNote,'maxlength="240"')}
          ${foodInput(key("storage"),"当前储存方式",c.storage,'maxlength="240"')}
          ${foodInput(key("storageAdvice"),"包装储存说明",c.storageAdvice,'maxlength="240"')}
          ${foodInput(key("checkDays"),"检查周期（天）","",'type="number" min="1" max="3650"')}
        </div></details>
        ${(c.dateEvidence||(!c.expiresOn&&c.shortLife)||c.locationId==="unassigned")?
          `<p class="wide notice">${escape(c.dateEvidence || (!c.expiresOn&&c.shortLife?"短保食品建议核对包装标注日期。":""))}
          ${c.locationId==="unassigned"?" 请确认储存位置。":""}</p>`:""}</fieldset>`);
      continue;
    }
    const options=intakeBatchOptions(c,rows);
    if (c.intent==="query") {
      actions.push(`<section class="panel editor"><h2>查询库存 · ${escape(c.name||"全部")}</h2><div class="food-list">${options.filter((r)=>!c.locationId||c.locationId==="unassigned"||r.locationId===c.locationId).map((r)=>
        link(foodHref(r),escape(foodTitle(r))+" · "+escape(r.locationName)+" · "+escape(foodAmount(r)))).join("")||"<p>暂无匹配批次。</p>"}</div></section>`);
      continue;
    }
    const stockEdit=["adjust","consume"].includes(c.intent);
    const fields=stockEdit?foodInput("amount",c.intent==="consume"?"消耗量":"调整后的剩余量",c.amount,foodNumberAttrs)+
      foodInput("unit","单位",c.unit,'maxlength="20"')+foodInput("amountNote","模糊数量",c.amountNote||"",'maxlength="240"'):"";
    const place=["move","open"].includes(c.intent)?foodDropdown("locationId","位置",foodOption("","保留原位置","")+foodOptions(locations,c.locationId==="unassigned"?"":c.locationId)):"";
    actions.push(`<section><div class="section-heading"><h2>${intakeLabels[c.intent]} · ${escape(c.name)}</h2></div>${options.length?foodModuleForm(
      intakeHidden("operation","apply-action")+intakeHidden("draft",draft.id)+intakeHidden("index",index)+
      foodDropdown("batchId","确认操作批次",foodOption("","请选择批次","")+options.map((r)=>foodOption(r.id,
        [foodTitle(r),r.locationName,r.purchasedOn,foodAmount(r)].filter(Boolean).join(" · "),"")).join(""),"required")+
      fields+place,"确认更新"):"<p>没有匹配的在库批次。可返回库存页选择食品。</p>"}</section>`);
  }
  return render(title+`<p class="notice">${draft.source==="rules"?"规则提取":"AI 提取"} · 日期、位置和数量请以实际情况为准。${transcript?" 转写："+escape(transcript):""}</p>`+
    (purchases.length?`<form class="food-confirm" method="post">${intakeHidden("operation","confirm")}${intakeHidden("draft",draft.id)}
      ${purchases.join("")}<div class="food-toolbar"><button class="btn btn-primary">确认并保存</button>${entryButton(foodRoot+"/intake","取消","secondary")}</div></form>`:"")+actions.join(""));
}

function intakeClaim(db,id,index,now,guard="",keys=[]) {
  return foodRead(db,`INSERT INTO FoodIntakeConfirmation(draftId,candidateIndex,confirmedAt)
    SELECT ?,?,? ${guard?"WHERE "+guard:""}`,id,index,now,...keys);
}
const intakeConfirmedFields={
  name:"name",brand:"brand",categoryId:"categoryId",specification:"specification",purchasedOn:"purchasedOn",
  expiryMode:"expiryMode",purchaseTime:"purchaseTime",producedOn:"producedOn",expiresOn:"expiresOn",shelfLifeDays:"shelfLifeDays",shelfLifeBase:"shelfLifeBase",purchasedAmount:"amount",
  unit:"unit",amountNote:"amountNote",locationId:"locationId",storage:"storage",storageAdvice:"storageAdvice",checkDays:"checkDays",
};
function intakeConfirmFollowup(form,prefix,candidate,followup) {
  if (!followup) return null;
  const get=(name)=>foodValue(form,prefix+name);
  const initialUnit=get("initialUnit");
  const initialAmount=get("initialAmount")===""?null:Number(get("initialAmount"));
  const consumedUnit=get("consumedUnit");
  const consumedAmount=get("consumedAmount")===""?null:Number(get("consumedAmount"));
  const valid=(amount)=>amount!=null&&Number.isFinite(amount)&&amount>0&&amount<=1000000;
  if ((initialAmount!=null&&(!valid(initialAmount)||!initialUnit)) || initialUnit.length>20 ||
      (followup==="partial"&&(!valid(initialAmount)||!valid(consumedAmount)||consumedAmount>initialAmount||
        !initialUnit||initialUnit!==consumedUnit))) {
    throw new IntakeError("请用同一单位核对消耗前数量与消耗量。系统无法在重量和个数之间自动换算。");
  }
  const purchaseUnit=foodValue(candidate,"unit");
  const remaining=followup==="all"?0:Number((initialAmount-consumedAmount).toFixed(6));
  candidate.set("purchasedUnit",purchaseUnit);
  candidate.set("unit",initialUnit||purchaseUnit);
  candidate.set("remainingAmount",String(remaining));
  candidate.set("amountNote","");
  return {initialAmount,initialUnit,consumedAmount:followup==="all"?initialAmount:consumedAmount,
    consumedUnit:followup==="all"?initialUnit:consumedUnit,remaining};
}
async function intakeSavePurchases(db,form,draft,candidates,profiles) {
  const now=new Date().toISOString(), writes=[], pendingProfiles=new Map();
  let saved=0;
  for (const [index,c] of candidates.entries()) {
    if (c.intent!=="purchase") continue;
    const prefix=`candidate-${index}-`;
    const candidate=new FormData();
    const sourceFields={};
    for (const [field,key] of Object.entries(intakeConfirmedFields)) {
      const value=foodValue(form,prefix+field);
      candidate.set(field,value);
      if (value) sourceFields[field]=value!==String(c[key]??"")?"user":
        (key==="purchasedOn"&&c.systemDate)||(key==="purchaseTime"&&c.systemTime)?"system":draft.source;
    }
    const match=intakeMatch(c,profiles);
    const choice=foodValue(form,prefix+"foodId");
    const selected=choice==="new"?"":choice;
    if (match.options.length && !choice) throw new IntakeError("请选择已有档案或新建档案。");
    if (selected&&!match.options.some((r)=>r.id===selected)) {
      throw new IntakeError("档案匹配已发生变化，请重新提取后确认。",409);
    }
    const get=(name)=>foodValue(candidate,name);
    if (selected) {
      const profile=profiles.find((r)=>r.id===selected);
      if ((get("brand")&&profile.brand&&intakeNameKey(get("brand"))!==intakeNameKey(profile.brand)) ||
          (get("specification")&&profile.specification&&intakeNameKey(get("specification"))!==intakeNameKey(profile.specification))) {
        throw new IntakeError("品牌或规格与选中的档案不同。请选择新建档案，或核对信息。",409);
      }
      candidate.set("foodId",selected);
    }
    candidate.set("expiryLead","3");
    candidate.set("timeZone",c.timeZone);
    if (get("expiresOn")!==c.expiresOn && get("shelfLifeBase")===(c.shelfLifeBase||"")) candidate.set("shelfLifeBase","");
    const expirySource=get("expiresOn")&&get("expiresOn")===c.expiresOn ? c.expirySource : "stated";
    const identity=intakeProfileKey({name:get("name"),brand:get("brand"),specification:get("specification")});
    const followup=intakeConfirmFollowup(form,prefix,candidate,c.followup);
    const batch=await foodCreate(db,candidate,now,true,
      {method:draft.source,fields:sourceFields,confirmedAt:now,dateEvidence:c.dateEvidence||null,expirySource},
      selected?null:pendingProfiles.get(identity),followup);
    if (!batch) throw new IntakeError(`请检查第 ${index+1} 条的食品名称、日期、数量和位置。`);
    if (!selected) pendingProfiles.set(identity,batch.pid);
    writes.push(intakeClaim(db,draft.id,index,now),...batch.writes);
    saved++;
  }
  if (!saved) throw new IntakeError("没有待保存的采购条目。");
  try { await db.batch(writes); } catch { throw new IntakeError("保存失败。请检查是否已确认过这批记录。",409); }
  return foodRedirect(foodRoot+"?imported="+saved+"#inventory");
}
async function intakeApplyAction(db,form,draft,candidates,rows) {
  const rawIndex=foodValue(form,"index");
  const index=Number(rawIndex);
  const candidate=/^\d+$/.test(rawIndex)?candidates[index]:null;
  if (!candidate||["purchase","query"].includes(candidate.intent)) throw new IntakeError("请重新识别并确认操作。");
  const row=intakeBatchOptions(candidate,rows).find((r)=>r.id===foodValue(form,"batchId"));
  if (!row) throw new IntakeError("请选择仍在库且匹配的批次。",409);
  const action=new FormData();
  action.set("operation",candidate.intent);
  for (const key of ["amount","unit","amountNote","locationId"]) action.set(key,foodValue(form,key));
  try {
    return await foodUpdateBatch(db,row,action,{draftId:draft.id,index,source:draft.source});
  } catch { throw new IntakeError("更新失败。请检查是否已经确认过该条操作。",409); }
}
async function foodIntake(request,env,form) {
  const db=env.DB, hasAI=intakeConfigured(env), media=intakeMediaEnabled(env);
  const provider={media,label:intakeLabel(env)};
  if (!form) return intakeEntry(hasAI,"",200,provider);
  try {
    const operation=foodValue(form,"operation");
    const [profiles,locations,categories]=await foodReferenceData(db);
    const owner=intakeOwner(request);
    if (["confirm","apply-action"].includes(operation)) {
      const draft=await foodOne(db,"SELECT * FROM FoodIntakeDraft WHERE id=? AND owner=? AND expiresAt>? AND source NOT LIKE 'drug-%'",
        foodValue(form,"draft"),owner,new Date().toISOString());
      if (!draft) throw new IntakeError("确认卡片已过期，请重新录入。",409);
      const candidates=JSON.parse(draft.candidates);
      return operation==="confirm"?await intakeSavePurchases(db,form,draft,candidates,profiles):
        await intakeApplyAction(db,form,draft,candidates,await allFoodRows(db));
    }
    const method=foodValue(form,"method")||"text";
    if (!["photo","voice","text"].includes(method)) throw new IntakeError("录入方式无效。");
    if (method!=="text"&&!hasAI) return intakeEntry(false,"AI 服务未配置，可先使用文字或手动录入。",503);
    if (method!=="text"&&!media) return intakeEntry(hasAI,"当前只启用文字 AI 识别，照片和语音录入未开启。",503,provider);
    const timeZone=intakeZone(foodValue(form,"timeZone"));
    const clock=intakeClock(timeZone);
    let text=foodValue(form,"text");
    if (method==="text"&&(!text||text.length>3000)) throw new IntakeError("请输入不超过 3,000 字的食品描述。");
    if (method==="voice") text=await intakeTranscribe(env,form.get("audio"));
    const photos=method==="photo"?await intakePhotoContent(form):[];
    const raw=hasAI?intakeMergePurchases(await intakeExtract(env,{text,photos,zone:timeZone,clock,locations,categories}),text,locations,clock):
      intakeRuleRows(text,locations,clock);
    if (!raw.length) throw new IntakeError("没有提取到待确认的食品。",422);
    const candidates=raw.map((row)=>({
      ...intakeNormalize(row.intent==="purchase"?intakeResolveDates(row,text,raw,clock,method):row,{locations,categories,clock}),timeZone,
    }));
    const draft={id:crypto.randomUUID(),source:hasAI?"ai-"+method:"rules"};
    await intakeStoreDraft(db,owner,draft,candidates);
    const rows=raw.some((r)=>r.intent!=="purchase")?await allFoodRows(db):[];
    return intakeReview(draft,candidates,profiles,locations,categories,rows,method==="voice"?text:"");
  } catch (error) {
    if (error instanceof IntakeError) return intakeEntry(hasAI,error.message,error.status,provider);
    throw error;
  }
}
async function intakeStoreDraft(db,owner,draft,candidates) {
  const now=new Date().toISOString();
  const expiresAt=new Date(Date.now()+30*60000).toISOString();
  await db.batch([
    foodRead(db,"DELETE FROM FoodIntakeConfirmation WHERE draftId IN (SELECT id FROM FoodIntakeDraft WHERE expiresAt<=?)",now),
    foodRead(db,"DELETE FROM FoodIntakeDraft WHERE expiresAt<=?",now),
    foodRead(db,"INSERT INTO FoodIntakeDraft(id,owner,candidates,source,expiresAt) VALUES (?,?,?,?,?)",
      draft.id,owner,JSON.stringify(candidates),draft.source,expiresAt),
  ]);
}
