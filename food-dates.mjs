export function resolveFoodDates(text, day) {
  const source=String(text??"").normalize("NFKC");
  const end="(?:过期|到期|有效期至)";
  const count="[0-9零一二两三四五六七八九十百千]+";
  const readCount=(value)=>{
    if (/^\d+$/.test(value)) return Number(value);
    const digits="零一二三四五六七八九";
    let total=0,current=0;
    for (const ch of value.replaceAll("两","二")) {
      const position=digits.indexOf(ch);
      if (position>=0) current=position;
      else { total+=(current||1)*({十:10,百:100,千:1000}[ch]||0); current=0; }
    }
    return total+current;
  };
  const validDays=(value)=>Number.isInteger(value)&&value>=1&&value<=36500;
  // Shelf life is usually spoken as 天/日, but packaging often says 个月 or 年. Those are
  // approximate (30 days per month, 365 per year), so the conversion is flagged for review.
  const durationUnit={天:1,日:1,周:7,星期:7,月:30,"个月":30,年:365};
  const durationMatches=[...source.matchAll(new RegExp(`(?:保质期|保存期|有效期)\\s*(?:为|是|约|大概|[:：])?\\s*(${count})\\s*(个?月|年|个?星期|[天日周])`,"g"))];
  const durations=durationMatches.map((m)=>readCount(m[1])*durationUnit[m[2]]);
  const approximated=durationMatches.some((m)=>m[2]!=="天"&&m[2]!=="日");
  const halfYear=/(?:保质期|保存期)\s*(?:为|是|约)?\s*半年/.test(source);
  if (halfYear) durations.push(182);
  const variants=[...new Set(durations)];
  const shelfLifeDays=variants.length===1&&validDays(variants[0])?variants[0]:null;
  const shelfLifeBase=shelfLifeDays?"production":"";
  const dates=[];
  const add=(value,kind,evidence)=>{
    dates.push({value:foodDate(value)?value:"",kind,evidence});
  };
  for (const match of source.matchAll(new RegExp(`(${count})\\s*(个?月|年|个?星期|[天日周])\\s*(?:之)?后\\s*(?:就)?${end}`,"g"))) {
    const days=readCount(match[1])*durationUnit[match[2]];
    add(validDays(days)?foodAddDays(day,days):"","relative",match[0]);
  }
  for (const match of source.matchAll(new RegExp(`(今天|明天|后天)\\s*(?:就)?${end}`,"g"))) {
    add(foodAddDays(day,{今天:0,明天:1,后天:2}[match[1]]),"relative",match[0]);
  }
  const datePattern="(?:([0-9]{4})\\s*(?:年|[-/])\\s*)?([0-9]{1,2})\\s*(?:月|[-/])\\s*([0-9]{1,2})\\s*(?:日|号)?";
  for (const pattern of [`(?<![0-9])${datePattern}\\s*${end}`,
    `(?:到期(?:日期|日)?|过期(?:日期|日)?|有效期(?:至|到)?|保质期(?:到|至|截止到?)?|保存期(?:到|至)?|限用日期)\\s*(?:是|为|[:：])?\\s*${datePattern}(?![0-9])`]) {
    for (const match of source.matchAll(new RegExp(pattern,"g"))) {
      const [,year,month,date]=match;
      add(`${year||day.slice(0,4)}-${month.padStart(2,"0")}-${date.padStart(2,"0")}`,year?"stated":"year-confirm",match[0]);
    }
  }
  const useBy = [...source.matchAll(new RegExp("("+count+")\\s*(?:天|日)(?:之)?内\\s*(?:要|得|需要|尽量|记得)?\\s*(?:吃完|喝完|用完|食用完)|(?:一周|一个星期)(?:之)?内\\s*(?:吃完|喝完|用完)", "g"))];
  if (!dates.length) {
    for (const match of useBy) {
      const days = match[1] ? readCount(match[1]) : 7;
      add(validDays(days)?foodAddDays(day,days):"", "consume-by", match[0]);
    }
  }
  const uniques=[...new Set(dates.map((entry)=>entry.value))];
  const production=source.match(new RegExp(`(?:生产(?:日期|日)?)(?:为|是|[:：])?\\s*${datePattern}(?![0-9])`));
  const producedOn=production?`${production[1]||day.slice(0,4)}-${production[2].padStart(2,"0")}-${production[3].padStart(2,"0")}`:"";
  const resolved=uniques.length===1&&uniques[0]?dates[0]:null;
  const notes=[];
  if (useBy.length) notes.push("已按用户描述计算到期日期，请核对。");
  if (dates.length&&!resolved) notes.push("到期日期无效或相互冲突，请确认。");
  if (!dates.length&&/到期|过期|有效期至/.test(source)) notes.push("到期日期尚未明确，请确认。");
  if (resolved?.kind==="year-confirm") notes.push(`原文没有指定年份，已按录入地的 ${day.slice(0,4)} 年预填，请核对年份。`);
  if (resolved?.kind==="relative") notes.push(`按录入地日期 ${day} 计算到期日期，请核对。`);
  if (variants.length&&!shelfLifeDays) notes.push("保质期天数无效或相互冲突，请确认。");
  if (approximated&&shelfLifeDays) notes.push(`保质期包含月或年，已按每月 30 天、每年 365 天估算为 ${shelfLifeDays} 天，请核对。`);
  if (production&&!production[1]) notes.push(`生产日期原文没有年份，已按录入地的 ${day.slice(0,4)} 年预填，请核对。`);
  if (shelfLifeDays&&!resolved&&!foodDate(producedOn)) notes.push("请补充生产日期以计算到期日期。");
  return {expiresOn:resolved?.value||"",expirySource:resolved?.kind||"",shelfLifeDays,shelfLifeBase,dateEvidence:notes.join(" "),
    producedOn:foodDate(producedOn)?producedOn:""};
}
