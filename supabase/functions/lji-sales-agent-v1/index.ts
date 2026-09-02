import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'method_not_allowed'},405)
  try{
    const auth=req.headers.get('Authorization')||''
    if(!auth.startsWith('Bearer ')) return json({error:'unauthorized'},401)
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!
    const anon=Deno.env.get('SUPABASE_ANON_KEY')!
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient=createClient(supabaseUrl,anon,{global:{headers:{Authorization:auth}}})
    const {data:{user},error:userErr}=await userClient.auth.getUser()
    if(userErr||!user) return json({error:'invalid_session'},401)
    const body=await req.json()
    const workspaceId=String(body?.workspace_id||'')
    if(!workspaceId) return json({error:'workspace_required'},400)
    const admin=createClient(supabaseUrl,service)
    const {data:member,error:memberErr}=await admin.from('lji_workspace_members').select('user_id,role,is_active').eq('workspace_id',workspaceId).eq('user_id',user.id).maybeSingle()
    if(memberErr||!member||member.is_active===false) return json({error:'workspace_forbidden'},403)

    const apiKey=Deno.env.get('ANTHROPIC_API_KEY')
    if(!apiKey) return json({error:'anthropic_not_configured'},503)
    const model=Deno.env.get('ANTHROPIC_MODEL')||'claude-sonnet-4-5'
    const lead=body?.lead||{}, memory=Array.isArray(body?.memory)?body.memory.slice(0,8):[], goal=String(body?.goal||'next')
    const system=`Você é o agente comercial do LJ Sales, especializado em vendas imobiliárias no Brasil. Escreva mensagens naturais, curtas, profissionais, persuasivas sem pressão artificial. Nunca invente preço, imóvel, condição, prazo, financiamento, visita ou fato ausente. Use somente os dados fornecidos. Não prometa disponibilidade. Não diga que é IA. O objetivo é avançar uma etapa comercial com uma pergunta ou CTA claro. Responda exclusivamente JSON válido com: draft, confidence (forte|parcial|limitado), reasoning_summary (máx. 180 caracteres), recommended_action (máx. 180 caracteres). draft deve estar pronto para WhatsApp e ter no máximo 650 caracteres.`
    const userPrompt=`OBJETIVO: ${goal}\nLEAD: ${JSON.stringify(lead)}\nMEMÓRIA COMERCIAL (mais recente primeiro): ${JSON.stringify(memory)}\nGere a melhor abordagem para este lead agora.`
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model,max_tokens:500,temperature:0.35,system,messages:[{role:'user',content:userPrompt}]})})
    if(!r.ok){const t=await r.text();console.error('Anthropic',r.status,t.slice(0,500));return json({error:'anthropic_error'},502)}
    const out=await r.json(), text=String(out?.content?.find((x:any)=>x.type==='text')?.text||'').trim()
    let parsed:any; try{parsed=JSON.parse(text.replace(/^```json\s*|\s*```$/g,''))}catch{return json({error:'invalid_model_output'},502)}
    const draft=String(parsed?.draft||'').trim().slice(0,900)
    if(!draft)return json({error:'empty_draft'},502)
    return json({draft,confidence:String(parsed?.confidence||'parcial'),reasoning_summary:String(parsed?.reasoning_summary||'').slice(0,220),recommended_action:String(parsed?.recommended_action||'').slice(0,220),engine:`anthropic:${model}`})
  }catch(e){console.error(e);return json({error:'internal_error'},500)}
})
