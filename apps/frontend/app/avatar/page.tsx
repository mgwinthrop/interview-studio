"use client";
import { useState } from "react";
import { Nav } from "../components/Nav";
import { InterviewerAvatar, AVATAR_LABELS, type AvatarState } from "../components/InterviewerAvatar";
import { MotionToggle } from "../components/MotionToggle";

export default function AvatarPreview() {
  const [state, setState] = useState<AvatarState>("listening");
  return <main id="main-content" tabIndex={-1} style={{minHeight:"100vh", background:"#F4F5F1"}}><Nav />
    <section style={{maxWidth:850, margin:"0 auto", padding:"48px 24px"}}>
      <p style={{color:"#06616B", fontWeight:700, fontSize:12, letterSpacing:".14em"}}>INTERVIEW STUDIO / AVATAR PREVIEW</p>
      <h1 style={{fontSize:40, fontWeight:800, letterSpacing:"-.04em", margin:"12px 0"}}>A face for the conversation.</h1>
      <p style={{color:"#4B5563", marginBottom:28}}>Meet the animated interviewer. Try each state below — no microphone or API keys needed.</p>
      <div style={{background:"#102B33", borderRadius:24, padding:32, display:"flex", alignItems:"center", flexDirection:"column", color:"white", gap:16}}>
        <InterviewerAvatar state={state} />
        <p role="status" aria-live="polite" style={{fontWeight:600}}>{AVATAR_LABELS[state]}</p>
        <MotionToggle />
      </div>
      <div style={{display:"flex", flexWrap:"wrap", gap:10, marginTop:24}}>
        {(Object.keys(AVATAR_LABELS) as AvatarState[]).map(key => <button key={key} onClick={()=>setState(key)} aria-pressed={state===key} style={{background:state===key?"#06616B":"white", color:state===key?"white":"#102B33", border:"1px solid #B5CDCE", padding:"10px 16px", borderRadius:999, cursor:"pointer"}}>{AVATAR_LABELS[key]}</button>)}
      </div>
      <p style={{fontSize:13, color:"#4B5563", marginTop:24}}>The interviewer is an animated AI character. Animation follows interview and audio playback state; it is not phoneme-level lip sync. Reduced-motion preferences are respected.</p>
    </section>
  </main>;
}
