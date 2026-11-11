// Province identity comes exclusively from Cloudflare's trusted request.cf metadata.
const codes = {BJ:11,TJ:12,HE:13,SX:14,NM:15,LN:21,JL:22,HL:23,SH:31,JS:32,ZJ:33,AH:34,FJ:35,JX:36,SD:37,HA:41,HB:42,HN:43,GD:44,GX:45,HI:46,CQ:50,SC:51,GZ:52,YN:53,XZ:54,SN:61,GS:62,QH:63,NX:64,XJ:65};
const names = {beijing:11,tianjin:12,hebei:13,shanxi:14,innermongolia:15,liaoning:21,jilin:22,heilongjiang:23,shanghai:31,jiangsu:32,zhejiang:33,anhui:34,fujian:35,jiangxi:36,shandong:37,henan:41,hubei:42,hunan:43,guangdong:44,guangxi:45,hainan:46,chongqing:50,sichuan:51,guizhou:52,yunnan:53,tibet:54,xizang:54,shaanxi:61,gansu:62,qinghai:63,ningxia:64,xinjiang:65};
export function requestRegion(cf) {
  const raw = String(cf?.country || "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) ? raw : "ZZ";
  if ({HK:1,MO:1,TW:1}[country]) return {country, province: {HK:"810000",MO:"820000",TW:"710000"}[country]};
  if (country !== "CN") return {country, province:"unknown"};
  const code = String(cf?.regionCode || "").toUpperCase().replace(/^CN-/, "");
  const numeric = /^\d{2}$/.test(code) && Object.values(codes).includes(Number(code)) ? Number(code) : codes[code];
  const name = String(cf?.region || "").toLowerCase().replace(/[^a-z]/g, "");
  const prefix = numeric || Object.entries(names).find(([key]) => name === key || name.startsWith(key + "autonomous"))?.[1];
  return {country, province: prefix ? String(prefix) + "0000" : "unknown"};
}
