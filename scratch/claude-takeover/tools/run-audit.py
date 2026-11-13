import json, os, subprocess, time, hashlib, sys
L=os.path.expanduser('~/3db-linux')
D=os.path.expanduser('~/mnt/3DB實機確認')
OUT=os.path.expanduser(os.environ.get('AUDIT_OUT','~/mnt/3D-Builder/scratch/claude-takeover/step-audit'))
PREV=os.path.expanduser('~/mnt/3D-Builder/scratch/feature-recognition/real-step-editable/all-steps-miter-audit.json')
files=[]
for root,_,fs in os.walk(D):
    for f in fs:
        if f.lower().endswith(('.step','.stp')): files.append(os.path.relpath(os.path.join(root,f),D))
files.sort()
prev={}
for r in json.load(open(PREV)):
    prev.setdefault(r['relPath'],[]).append({k:r.get(k) for k in ('label','status','elapsedMs')})
DATA=os.path.join(OUT,'data.js')
def save():
    state['updated']=time.time()
    tmp=DATA+'.tmp'
    with open(tmp,'w',encoding='utf-8') as f: f.write('window.STEP_AUDIT='+json.dumps(state,ensure_ascii=False)+';')
    os.replace(tmp,DATA)
if os.path.exists(DATA) and sys.argv[1:]!=['reset']:
    t=open(DATA,encoding='utf-8').read(); state=json.loads(t[len('window.STEP_AUDIT='):-1])
else:
    state={'started':time.time(),'updated':time.time(),'finished':None,'files':[]}
    seen={}
    for rel in files:
        h=hashlib.sha256(open(os.path.join(D,rel),'rb').read()).hexdigest()
        state['files'].append({'rel':rel,'state':'wait','dupOf':seen.get(h),'rows':[],'start':None,'end':None,'prev':prev.get(rel,[]),'log':''})
        seen.setdefault(h,rel)
    for f in state['files']:
        if f['dupOf']: f['state']='dup'
    save(); sys.exit(0)
pending=[(i,f) for i,f in enumerate(state['files']) if f['state'] in ('wait','run')]
if not pending:
    state['finished']=state['finished'] or time.time(); save(); print('ALL DONE'); sys.exit(0)
i,f=pending[0]
f['state']='run'; f['start']=time.time(); save()
env=dict(os.environ, STEP_DIR=D, ONLY=os.path.join(D,f['rel']), STEP_OUT=os.path.join(L,'audit-out'), STEP_AUDIT_OUTPUT=f'{i:02d}.json', NODE_OPTIONS='--max-old-space-size=2600', **({'SKIP_EDIT':'1'} if 'CIV0000467治具' in f['rel'] else {}))
logp=os.path.join(L,'audit-out',f'{i:02d}.log'); os.makedirs(os.path.dirname(logp),exist_ok=True)
jp=os.path.join(L,'audit-out',f'{i:02d}.json')
if os.path.exists(jp): os.remove(jp)
try:
    p=subprocess.run(['npx','vitest','run','-c','scratch/feature-recognition/all.config.mts'],cwd=L,env=env,stdout=open(logp,'w'),stderr=subprocess.STDOUT,timeout=float(os.environ.get('LIMIT','168')))
    rc=p.returncode
except subprocess.TimeoutExpired: rc='timeout'
f['end']=time.time()
if os.path.exists(jp):
    rows=json.load(open(jp)); f['rows']=[{k:r.get(k) for k in ('label','faces','status','approximateUsed','elapsedMs','features','reason','editable','surfaceTypes')} for r in rows]
    for r in f['rows']:
        if r.get('reason'): r['reason']=r['reason'][:400]
    f['state']='done'
else:
    f['state']='error'; f['log']=open(logp,errors='replace').read()[-1500:]+f'\n[rc={rc}]'
save()
print(i,f['rel'],f['state'],rc,round(f['end']-f['start']),[(r['label'][:10],r['status'],r.get('approximateUsed')) for r in f['rows']])
