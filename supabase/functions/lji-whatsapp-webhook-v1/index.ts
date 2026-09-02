import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractProfileWithClaude, updateBuyerFromExplicit, fetchExistingProfile } from "../_shared/sales-match-profile.ts";

const digits=(v:unknown)=>String(v||"").replace(/\D/g,"");
const samePhone=(a:unknown,b:unknown)=>{const x=digits(a),y=digits(b);if(!x||!y)return false;const n=Math.min(10,x.length,y.length);return n>=8&&x.slice(-n)===y.slice(-n)};
const enc=new TextEncoder();
async function validSignature(raw:string,signature:string,secret:string){
  if(!signature.startsWith("sha256="))return false;const expected=signature.slice(7).toLowerCase();const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,enc.encode(raw));const actual=[...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("");if(actual.length!==expected.length)return false;let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);return diff===0;
}
function textFromMessage(m:any){return String(m?.text?.body||m?.button?.text||m?.interactive?.button_reply?.title||m?.interactive?.list_reply?.title||"").trim()}
function phonesFrom(v:unknown){const s=String(v||"");const out=new Set<string>();for(const m of s.matchAll(/(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]?\d{4}/g)){const d=digits(m[0]);if(d.length>=10)out.add(d)}return [...out]}
function leadTitle(type:string,row:any){if(type==="buyer")return row.name||"Comprador";if(type==="buyer_intent")return row.person_name||row.title||"Intenção";return row.contact_name||row.title||"Oportunidade"}
async function resolveLead(admin:any,workspace:string,phone:string){
  const {data:links}=await admin.from("lji_activity_log").select("entity_type,entity_id,details,created_at").eq("workspace_id",workspace).eq("event_type","whatsapp_lead_linked").order("created_at",{ascending:false}).limit(500);
  const persisted=(links||[]).find((e:any)=>samePhone(e.details?.phone,phone));if(persisted)return {entity_type:persisted.entity_type,entity_id:String(persisted.entity_id),title:persisted.details?.title||"Lead",lead_type:persisted.details?.lead_type||"Lead",method:"persisted"};
  const [buyersRes,intentsRes,historyRes]=await Promise.all([
    admin.from("lji_buyers").select("id,name,contact,status").eq("workspace_id",workspace).eq("status","active"),
    admin.from("lji_buyer_intents").select("id,person_name,title,contact,intent_text,status").eq("workspace_id",workspace).eq("status","active"),
    admin.rpc("lji_get_opportunity_history",{p_workspace:workspace})
  ]);
  const candidates:any[]=[];
  for(const row of buyersRes.data||[])if(phonesFrom(row.contact).some(p=>samePhone(p,phone)))candidates.push({entity_type:"buyer",entity_id:String(row.id),title:leadTitle("buyer",row),lead_type:"Comprador cadastrado"});
  for(const row of intentsRes.data||[])if(phonesFrom(`${row.contact||""} ${row.intent_text||""}`).some(p=>samePhone(p,phone)))candidates.push({entity_type:"buyer_intent",entity_id:String(row.id),title:leadTitle("buyer_intent",row),lead_type:"Comprador captado"});
  const seenOpp=new Set<string>();for(const row of historyRes.data||[]){const id=String(row.opportunity_id||"");if(!id||seenOpp.has(id)||row.is_current!==true)continue;seenOpp.add(id);const hay=[row.contact_verified_phone,row.contact_phone,row.whatsapp_url].filter(Boolean).join(" ");if(phonesFrom(hay).some(p=>samePhone(p,phone)))candidates.push({entity_type:"opportunity",entity_id:id,title:leadTitle("opportunity",row),lead_type:"Proprietário"})}
  const unique=[...new Map(candidates.map(x=>[`${x.entity_type}:${x.entity_id}`,x])).values()];return unique.length===1?{...unique[0],method:"phone_unique"}:null;
}
function heuristic(text:string){const t=text.toLowerCase();let score=0,intent="medium",objection:string|null=null,action="Responder e confirmar o próximo passo comercial.";if(/quero|tenho interesse|gostei|visita|visitar|proposta|fechar|comprar|alugar|hor[aá]rio/.test(t)){score+=12;intent="high";action=/visita|visitar|hor[aá]rio/.test(t)?"Propor duas opções reais de horário para visita.":"Avançar com uma pergunta objetiva para a próxima etapa."}if(/pre[cç]o|caro|valor|desconto|condi[cç][aã]o/.test(t)){objection="preço/condição";score-=2;action="Tratar valor e condição sem inventar desconto; confirmar o ponto que impede o avanço."}else if(/financi|cr[eé]dito|entrada|parcela/.test(t)){objection="financiamento";score+=2;action="Confirmar estrutura de pagamento e quais informações faltam para avançar."}else if(/bairro|regi[aã]o|longe|localiza[cç][aã]o/.test(t)){objection="localização";score-=1;action="Confirmar a região prioritária e restringir as opções ao que atende a rotina do cliente."}else if(/depois|agora n[aã]o|pensar|sem pressa|mais pra frente/.test(t)){objection="timing";score-=10;intent="low";action="Respeitar o timing e combinar uma retomada sem pressão."}if(/n[aã]o tenho interesse|desisti|n[aã]o quero|pare de/.test(t)){score=-20;intent="low";action="Interromper a pressão comercial e registrar o motivo antes de encerrar."}return {intent_level:intent,objection,score_delta:Math.max(-20,Math.min(20,score)),analysis_summary:"Classificação local baseada somente no conteúdo real da conversa.",recommended_action:action,confidence:"partial",stage_suggestion:intent==="high"?"replied":null,engine:"heuristic_fallback"}}
async function analyze(admin:any,workspace:string,phone:string,lead:any){
  const {data:events}=await admin.from("lji_activity_log").select("event_type,details,created_at").eq("workspace_id",workspace).eq("entity_type","whatsapp").eq("entity_id",phone).in("event_type",["whatsapp_message_received","whatsapp_message_sent"]).order("created_at",{ascending:true}).limit(30);const conv=events||[],fallback=heuristic(conv.map((x:any)=>x.details?.text||"").join("\n"));const key=Deno.env.get("ANTHROPIC_API_KEY");if(!key)return fallback;
  try{const model=Deno.env.get("ANTHROPIC_MODEL")||"claude-sonnet-4-5",transcript=conv.map((e:any)=>`${e.event_type==="whatsapp_message_received"?"CLIENTE":"EQUIPE"}: ${String(e.details?.text||"")}`).join("\n").slice(-12000),system=`Você analisa conversas comerciais imobiliárias reais no LJ Sales. Não invente fatos. Responda SOMENTE JSON válido com intent_level (high|medium|low), objection (string ou null), score_delta (-20..20), analysis_summary (máx 220 caracteres), recommended_action (máx 220 caracteres), confidence (strong|partial|limited), stage_suggestion (replied|qualified|visit_scheduled|proposal|negotiation|null).`,prompt=`LEAD: ${JSON.stringify(lead)}\nCONVERSA:\n${transcript}`;const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model,max_tokens:500,temperature:0.2,system,messages:[{role:"user",content:prompt}]})});if(!r.ok)return fallback;const out=await r.json(),raw=String(out?.content?.find((x:any)=>x.type==="text")?.text||"").trim(),p=JSON.parse(raw.replace(/^```json\s*|\s*```$/g,""));return {intent_level:["high","medium","low"].includes(p.intent_level)?p.intent_level:"medium",objection:p.objection?String(p.objection).slice(0,120):null,score_delta:Math.max(-20,Math.min(20,Math.round(Number(p.score_delta||0)))),analysis_summary:String(p.analysis_summary||"").slice(0,220),recommended_action:String(p.recommended_action||"").slice(0,220),confidence:["strong","partial","limited"].includes(p.confidence)?p.confidence:"partial",stage_suggestion:p.stage_suggestion?String(p.stage_suggestion):null,engine:`anthropic:${model}`}}catch(e){console.error("analysis fallback",e);return fallback}
}

/**
 * Automatic-path wrapper around the shared extraction module. Fetches the
 * conversation + the lead's existing cadastral profile (same context the
 * manual "Extrair busca + Match" button gets), extracts with the same
 * prompt/sanitization as the manual path, and applies the explicit fields
 * to lji_buyers — propagating any update error to the caller instead of
 * swallowing it.
 */
async function extractMatchProfile(admin:any,workspace:string,phone:string,lead:any){
  const {data:events}=await admin.from("lji_activity_log").select("event_type,details,created_at").eq("workspace_id",workspace).eq("entity_type","whatsapp").eq("entity_id",phone).in("event_type",["whatsapp_message_received","whatsapp_message_sent"]).order("created_at",{ascending:true}).limit(60);
  const rows=events||[];
  if(!rows.length)return {profile:null,engine:"no_conversation",updated_fields:[] as string[]};

  const existingProfile=await fetchExistingProfile(admin,workspace,{entity_type:lead.entity_type,entity_id:String(lead.entity_id)});
  const {profile,engine}=await extractProfileWithClaude(rows,{...lead,existing_profile:existingProfile});

  let updatedFields:string[]=[];
  if(lead?.entity_type==="buyer"&&profile.intent_role!=="seller"){
    const result=await updateBuyerFromExplicit(admin,workspace,String(lead.entity_id),profile);
    updatedFields=result.fields;
  }
  return {profile,engine,updated_fields:updatedFields};
}

Deno.serve(async(req)=>{
  const verify=Deno.env.get("META_WEBHOOK_VERIFY_TOKEN")||"";
  if(req.method==="GET"){const u=new URL(req.url);if(u.searchParams.get("hub.mode")==="subscribe"&&u.searchParams.get("hub.verify_token")===verify)return new Response(u.searchParams.get("hub.challenge")||"",{status:200});return new Response("forbidden",{status:403})}
  if(req.method!=="POST")return new Response("method",{status:405});
  try{
    const raw=await req.text(),secret=Deno.env.get("META_APP_SECRET")||"";if(!secret)return new Response("webhook_not_configured",{status:503});if(!await validSignature(raw,req.headers.get("x-hub-signature-256")||"",secret))return new Response("invalid_signature",{status:401});const payload=JSON.parse(raw),workspace=Deno.env.get("LJI_WORKSPACE_ID")||"";if(!workspace)return new Response("workspace_not_configured",{status:503});const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    for(const entry of payload?.entry||[])for(const change of entry?.changes||[])for(const m of change?.value?.messages||[]){
      // Cada mensagem é isolada: se qualquer etapa (ex: extração com a IA,
      // update em lji_buyers) falhar, registramos o erro e seguimos para a
      // próxima mensagem do lote em vez de abortar o resto silenciosamente.
      try{
        const from=digits(m.from),text=textFromMessage(m),name=change?.value?.contacts?.find((c:any)=>String(c.wa_id)===String(m.from))?.profile?.name||"";if(!from||!m.id)continue;
        const {data:dupe}=await admin.from("lji_activity_log").select("id").eq("workspace_id",workspace).eq("event_type","whatsapp_message_received").contains("details",{message_id:m.id}).limit(1);if(dupe?.length)continue;
        const lead=await resolveLead(admin,workspace,from);
        await admin.from("lji_activity_log").insert({workspace_id:workspace,user_id:null,event_type:"whatsapp_message_received",entity_type:"whatsapp",entity_id:from,details:{phone:from,from,text,contact_name:name,message_id:m.id,type:m.type,timestamp:m.timestamp,linked_entity_type:lead?.entity_type||null,linked_entity_id:lead?.entity_id||null}});
        if(!lead)continue;
        await admin.from("lji_activity_log").insert([
          {workspace_id:workspace,user_id:null,event_type:"whatsapp_lead_linked",entity_type:lead.entity_type,entity_id:lead.entity_id,details:{phone:from,lead_type:lead.lead_type,title:lead.title,link_method:lead.method,message_id:m.id}},
          {workspace_id:workspace,user_id:null,event_type:"sales_contact_logged",entity_type:lead.entity_type,entity_id:lead.entity_id,details:{phone:from,channel:"WhatsApp",direction:"inbound",note:text||`Mensagem ${m.type||"recebida"}`,message_id:m.id,source:"official_whatsapp",author_name:name||"Contato"}}
        ]);
        const {data:stageEvents}=await admin.from("lji_activity_log").select("details,created_at").eq("workspace_id",workspace).eq("event_type","pipeline_stage_changed").eq("entity_type",lead.entity_type).eq("entity_id",lead.entity_id).order("created_at",{ascending:false}).limit(1);const oldStage=stageEvents?.[0]?.details?.new_stage||"new";if(["new","validated","contacted"].includes(oldStage))await admin.from("lji_activity_log").insert({workspace_id:workspace,user_id:null,event_type:"pipeline_stage_changed",entity_type:lead.entity_type,entity_id:lead.entity_id,details:{old_stage:oldStage,new_stage:"replied",lead_type:lead.lead_type,title:lead.title,changed_by_name:"WhatsApp oficial",automation:"whatsapp_inbound",message_id:m.id}});

        // Análise de intenção e extração de critérios são independentes uma
        // da outra: se uma falhar, a outra ainda roda e é registrada.
        try{
          const a=await analyze(admin,workspace,from,lead);
          await admin.from("lji_activity_log").insert({workspace_id:workspace,user_id:null,event_type:"sales_inbox_analysis",entity_type:lead.entity_type,entity_id:lead.entity_id,details:{phone:from,message_id:m.id,...a}});
        }catch(e){console.error(`sales_inbox_analysis failed for message ${m.id}`,e)}

        try{
          const mp=await extractMatchProfile(admin,workspace,from,lead);
          if(mp.engine!=="no_conversation"){
            await admin.from("lji_activity_log").insert({workspace_id:workspace,user_id:null,event_type:"sales_match_profile",entity_type:lead.entity_type,entity_id:lead.entity_id,details:{phone:from,message_id:m.id,profile:mp.profile,engine:mp.engine,updated_buyer:mp.updated_fields.length>0,updated_fields:mp.updated_fields,automation:"whatsapp_inbound"}});
          }
        }catch(e){console.error(`sales_match_profile failed for message ${m.id}`,e)}
      }catch(e){
        console.error(`webhook: failed processing message ${m?.id}`,e);
      }
    }
    return new Response("ok",{status:200});
  }catch(e){console.error(e);return new Response("ok",{status:200})}
});
