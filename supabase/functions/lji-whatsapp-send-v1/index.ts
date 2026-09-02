import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const digits=(v:unknown)=>String(v||"").replace(/\D/g,"");

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  try{
    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return json({ok:false,error:"unauthorized"},401);
    const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
    const {data:{user},error:userErr}=await userClient.auth.getUser();
    if(userErr||!user)return json({ok:false,error:"invalid_session"},401);
    const body=await req.json(),workspace=String(body.workspace_id||""),to=digits(body.to),text=String(body.text||"").trim();
    const entityType=body.entity_type?String(body.entity_type):null,entityId=body.entity_id?String(body.entity_id):null;
    if(!workspace||!to||!text)return json({ok:false,error:"dados_incompletos"},400);
    const admin=createClient(url,service);
    const {data:member}=await admin.from("lji_workspace_members").select("role,is_active").eq("workspace_id",workspace).eq("user_id",user.id).eq("is_active",true).maybeSingle();
    if(!member)return json({ok:false,error:"workspace_forbidden"},403);
    const token=Deno.env.get("META_WHATSAPP_TOKEN"),phoneId=Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID"),graph=Deno.env.get("META_GRAPH_VERSION")||"v23.0";
    if(!token||!phoneId)return json({ok:false,error:"whatsapp_not_configured"},503);
    const r=await fetch(`https://graph.facebook.com/${graph}/${phoneId}/messages`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to,type:"text",text:{body:text,preview_url:false}})});
    const out=await r.json(),messageId=out?.messages?.[0]?.id||null;
    if(!r.ok){
      await admin.from("lji_activity_log").insert({workspace_id:workspace,user_id:user.id,event_type:"whatsapp_message_failed",entity_type:"whatsapp",entity_id:to,details:{phone:to,text,error:out,linked_entity_type:entityType,linked_entity_id:entityId}});
      return json({ok:false,error:"meta_send_failed"},502);
    }
    await admin.from("lji_activity_log").insert({workspace_id:workspace,user_id:user.id,event_type:"whatsapp_message_sent",entity_type:"whatsapp",entity_id:to,details:{phone:to,text,message_id:messageId,linked_entity_type:entityType,linked_entity_id:entityId}});
    if(entityType&&entityId){
      await admin.from("lji_activity_log").insert([
        {workspace_id:workspace,user_id:user.id,event_type:"whatsapp_lead_linked",entity_type:entityType,entity_id:entityId,details:{phone:to,link_method:"outbound_confirmed",message_id:messageId}},
        {workspace_id:workspace,user_id:user.id,event_type:"sales_contact_logged",entity_type:entityType,entity_id:entityId,details:{phone:to,channel:"WhatsApp",direction:"outbound",note:text,message_id:messageId,source:"official_whatsapp"}}
      ]);
    }
    return json({ok:true,message_id:messageId});
  }catch(e){console.error(e);return json({ok:false,error:"internal_error"},500)}
});
