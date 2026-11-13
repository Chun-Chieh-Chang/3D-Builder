import json,sys,numpy as np,matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
name,title,freefaces=sys.argv[1],sys.argv[2],set(json.loads(sys.argv[3]) if len(sys.argv)>3 else [])
d=json.load(open(f'/tmp/{name}.mesh.json'))
P=np.array(d['positions'],float).reshape(-1,3); I=np.array(d['indices'],int).reshape(-1,3)
fr=d['faceRanges']; fr=[fr[str(i)] for i in range(len(fr))]
col=np.zeros(len(I),int)
for k in range(0,len(fr),3):
    s,c,f=fr[k],fr[k+1],fr[k+2]
    col[s//3:(s+c)//3]= 1 if f in freefaces else 0
tri=P[I]
n=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]); n/=np.linalg.norm(n,axis=1,keepdims=True)+1e-12
fig=plt.figure(figsize=(15,5),dpi=110)
views=[(25,-60),(25,60),(-20,150)]
for vi,(el,az) in enumerate(views):
    ax=fig.add_subplot(1,3,vi+1,projection='3d')
    e=np.radians(el);a=np.radians(az); L=np.array([np.cos(e)*np.cos(a),np.cos(e)*np.sin(a),np.sin(e)])
    sh=np.clip(np.abs(n@L),0.15,1)
    base=np.where(col[:,None]==1,np.array([0.95,0.45,0.2]),np.array([0.55,0.65,0.8]))
    c=base*sh[:,None]
    pc=Poly3DCollection(tri,facecolors=c,edgecolors='none'); ax.add_collection3d(pc)
    mn,mx=P.min(0),P.max(0); m=(mn+mx)/2; r=(mx-mn).max()/2
    ax.set_xlim(m[0]-r,m[0]+r);ax.set_ylim(m[1]-r,m[1]+r);ax.set_zlim(m[2]-r,m[2]+r);ax.view_init(el,az);ax.set_axis_off()
fig.suptitle(f'{title}  bbox {np.round(P.max(0)-P.min(0),2)} mm  (orange = freeform faces)')
plt.tight_layout(); plt.savefig(f'{sys.argv[4] if len(sys.argv)>4 else "/tmp"}/{name}.png')
