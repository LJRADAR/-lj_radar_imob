import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const digits=(v:unknown)=>String(v||"").replace(/\D/g,"");

type Analysis={intent_level:string;objection:string|null;score_delta:number;analysis_summary:string;recommended_action:string;confidence:string;stage_suggestion:string|null;engine:string};
function heuristic(text:string):Analysis{
  const t=text.toLowerCase();let score=0,intent="medium",objection:string|null=null,action="Responder e confirmar o próximo passo comercial.";
  if(/quero|tenho interesse|gostei|visita|visitar|proposta|fechar|comprar|alugar|quando podemos|hor[aá]rio/.test(t)){score+=12;intent="high";action=/visita|visitar|hor[aá]rio/.test(t)?"Propor duas opções reais de horário para visita.":"Avançar com uma pergunta objetiva para a próxima etapa."}
  if(/pre[cç]o|caro|valor|desconto|condi[cç][aã]o/.test(t)){objection="preço/condição";score-=2;action="Tratar valor e condição sem inventar desconto; confirmar o ponto que impede o avanço."}
  else if(/financi|cr[eé]dito|entrada|parcela/.test(t)){objection="financiamento";score+=2;action="Confirmar estrutura de pagamento e quais informações faltam para avançar."}
  else if(/bairro|regi[aã]o|longe|localiza[cç][aã]o/.test(t)){objection="localização";score-=1;action="Confirmar a região prioritária e restringir as opções ao que atende a rotina do cliente."}
  else if(/depois|agora n[aã]o|pensar|sem pressa|mais pra frente/.test(t)){objection="timing";score-=10;intent="low";action="Respeitar o timing e combinar uma retomada sem pressão."}
  if(/n[aã]o tenho interesse|desisti|n[aã]o quero|pare de/.test(t)){score=-20;intent="low";action="Interromper a pressão comercial e registrar o motivo antes de encerrar."}
  return {intent_level:intent,objection,score_delta:Math.max(-20,Math.min(20,score)),analysis_summary:"Classificação local baseada somente no conteúdo real da conversa.",recommended_action:action,confidence:"partial",stage_suggestion:intent==="high"?"replied":null,engine:"heuristic_fallback"};
}
async function analyzeWithClaude(conversation:any[],lead:any):Promise<Analysis>{
  const key=Deno.env.get("ANTHROPIC_API_KEY");if(!key)return heuristic(conversation.map(x=>x.details?.text||"").join("\n"));
  const model=Deno.env.get("ANTHROPIC_MODEL")||"claude-sonnet-4-5";
  const transcript=conversation.map(e=>`${e.event_type==="whatsapp_message_received"?"CLIENTE":"EQUIPE"}: ${String(e.details?.text||"")}`).join("\n").slice(-12000);
  const system=`Você analisa conversas comerciais imobiliárias reais no LJ Sales. Não invente fatos. Classifique apenas o que existe no histórico. Responda SOMENTE JSON válido com: intent_level (high|medium|low), objection (string ou null), score_delta (inteiro -20..20), analysis_summary (máx 220 caracteres), recommended_action (máx 220 caracteres), confidence (strong|partial|limited), stage_suggestion (replied|qualified|visit_scheduled|proposal|negotiation|null). Não sugira desconto, disponibilidade, preço ou condição não fornecida.`;
  const prompt=`LEAD: ${JSON.stringify(lead)}\nCONVERSA (cronológica):\n${transcript}`;
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model,max_tokens:500,temperature:0.2,system,messages:[{role:"user",content:prompt}]})});
  if(!r.ok)throw new Error(`anthropic_${r.status}`);const out=await r.json(),raw=String(out?.content?.find((x:any)=>x.type==="text")?.text||"").trim();const p=JSON.parse(raw.replace(/^```json\s*|\s*```$/g,""));
  return {intent_level:["high","medium","low"].includes(p.intent_level)?p.intent_level:"medium",objection:p.objection?String(p.objection).slice(0,120):null,score_delta:Math.max(-20,Math.min(20,Math.round(Number(p.score_delta||0)))),analysis_summary:String(p.analysis_summary||"").slice(0,220),recommended_action:String(p.recommended_action||"").slice(0,220),confidence:["strong","partial","limited"].includes(p.confidence)?p.confidence:"partial",stage_suggestion:p.stage_suggestion?String(p.stage_suggestion):null,engine:`anthropic:${model}`};
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  try{
    const auth=req.headers.get("Authorization")||"";if(!auth.startsWith("Bearer "))return json({ok:false,error:"unauthorized"},401);
    const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user}}=await userClient.auth.getUser();if(!user)return json({ok:false,error:"invalid_session"},401);
    const body=await req.json(),workspace=String(body.workspace_id||""),phone=digits(body.phone),lead=body.lead||{},entityType=String(lead.entity_type||""),entityId=String(lead.entity_id||"");if(!workspace||!phone||!entityType||!entityId)return json({ok:false,error:"dados_incompletos"},400);
    const admin=createClient(url,service);const {data:member}=await admin.from("lji_workspace_members").select("role,is_active").eq("workspace_id",workspace).eq("user_id",user.id).eq("is_active",true).maybeSingle();if(!member)return json({ok:false,error:"workspace_forbidden"},403);
    const {data:events,error}=await admin.from("lji_activity_log").select("event_type,details,created_at").eq("workspace_id",workspace).eq("entity_type","whatsapp").eq("entity_id",phone).in("event_type",["whatsapp_message_received","whatsapp_message_sent"]).order("created_at",{ascending:true}).limit(40);if(error)throw error;if(!events?.length)return json({ok:false,error:"conversation_empty"},404);
    const analysis=await analyzeWithClaude(events,lead).catch(()=>heuristic(events.map((x:any)=>x.details?.text||"").join("\n")));
    await admin.from("lji_activity_log").insert([
      {workspace_id:workspace,user_id:user.id,event_type:"whatsapp_lead_linked",entity_type:entityType,entity_id:entityId,details:{phone,link_method:"analysis_confirmed"}},
      {workspace_id:workspace,user_id:user.id,event_type:"sales_inbox_analysis",entity_type:entityType,entity_id:entityId,details:{phone,...analysis,analyzed_messages:events.length}}
    ]);
    return json({ok:true,...analysis});
  }catch(e){console.error(e);return json({ok:false,error:"internal_error"},500)}
});
