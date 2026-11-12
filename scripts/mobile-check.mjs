import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import pg from "pg";
const B="http://127.0.0.1:3101";
const s=spawn("npx",["next","start","-p","3101"],{cwd:"/home/user/reverse1",detached:true,stdio:"ignore",env:{...process.env,APP_DATABASE_URL:"postgresql://erp_app:apppw@localhost:5433/erp_demo?host=/tmp/pgdata",APP_URL:B,INSECURE_COOKIES:"true",STORAGE_DIR:"/tmp/claude-0/st"}});
for(let i=0;i<60;i++){try{if((await fetch(B+"/api/health")).ok)break}catch{}await new Promise(r=>setTimeout(r,500))}
const c=new pg.Client({connectionString:"postgresql://postgres@localhost:5433/erp_demo?host=/tmp/pgdata"});await c.connect();
const pid=(await c.query("select id from projects")).rows[0].id;
const br=await chromium.launch();let bad=0;
for(const [email,pages] of [["owner@demo.example",["/app","/app/projects","/app/team","/app/settings","/app/projects/"+pid,"/app/projects/"+pid+"/boq","/app/projects/"+pid+"/measurements","/app/projects/"+pid+"/bills","/app/projects/"+pid+"/budget"]],["client@demo.example",["/app","/app/projects/"+pid]]]){
 const ctx=await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await ctx.newPage();
 await p.goto(B+"/login");await p.getByLabel("Email").fill(email);await p.getByLabel("Password").fill("Demo-pass-12345");await p.getByRole("button",{name:"Sign in"}).click();await p.waitForURL(/\/app/);
 for(const u of ["/",...pages]){await p.goto(B+u);await p.waitForTimeout(300);
  const ov=await p.evaluate(()=>{const w=document.documentElement.clientWidth;return [...document.querySelectorAll("body *")].filter(e=>{const r=e.getBoundingClientRect();return r.right>w+1&&!e.closest(".overflow-x-auto")&&getComputedStyle(e).position!=="fixed"}).length});
  const ax=(await new AxeBuilder({page:p}).withTags(["wcag2a","wcag2aa"]).analyze()).violations.map(v=>v.id);
  const sm=await p.evaluate(()=>[...document.querySelectorAll("a,button,input,select")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<24}).length);
  if(ov||ax.length){bad++}console.log(email.split("@")[0],u.replace(pid,"<p>"),"overflowEls="+ov,"axe="+ax.join(",")||"ok","tinyTargets="+sm)}
}
await br.close();await c.end();try{process.kill(-s.pid)}catch{};console.log(bad?"ISSUES "+bad:"MOBILE OK")
