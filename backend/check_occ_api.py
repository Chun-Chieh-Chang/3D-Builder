from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
shell = BRepOffsetAPI_MakeThickSolid()
print("Methods in BRepOffsetAPI_MakeThickSolid:")
for m in dir(shell):
    if not m.startswith("_"):
        print(f"  {m}")
