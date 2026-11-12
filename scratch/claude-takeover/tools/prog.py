# usage: prog.py stop <why> | init | item <phase> <idx> <st> [frac] [note] | now <html> | log <msg> | target <idx1based> <st> [note] | add <phase> <text>
import json,sys,time,os
D=os.path.expanduser('~/mnt/3D-Builder/scratch/claude-takeover/dev'); S=os.path.join(D,'state.json')
def save(s):
    s['updated']=time.time(); json.dump(s,open(S,'w'),ensure_ascii=False)
    open(os.path.join(D,'data.js.tmp'),'w',encoding='utf-8').write('window.DEV='+json.dumps(s,ensure_ascii=False)+';'); os.replace(os.path.join(D,'data.js.tmp'),os.path.join(D,'data.js'))
a=sys.argv[1:]
if a[0]=='init':
    s=json.load(open(a[1]))
    s['started']=time.time(); s['log']=[]; save(s); sys.exit()
s=json.load(open(S))
# any update means the work is going; `stop` says it has ended (the page shows it, and also flags 8 minutes without an update)
s['run']={'state':'stopped','t':time.time(),'why':a[1] if len(a)>1 else ''} if a[0]=='stop' else {'state':'running','t':time.time()}
if a[0]=='stop': pass
elif a[0]=='item':
    it=s['phases'][int(a[1])]['items'][int(a[2])]; it['st']=a[3]
    if len(a)>4 and a[4]!='-': it['frac']=float(a[4])
    if len(a)>5: it['note']=a[5]
elif a[0]=='now': s['now']=a[1]
elif a[0]=='log': s['log'].append({'t':time.time(),'m':a[1]}); s['log']=s['log'][-60:]
elif a[0]=='target':
    t=s['targets'][int(a[1])-1]; t['st']=a[2]
    if len(a)>3: t['note']=a[3]
elif a[0]=='add': s['phases'][int(a[1])]['items'].append({'t':a[2],'st':'wait'})
save(s)
