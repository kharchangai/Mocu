from pathlib import Path
base = Path("E:/mocube/mocu")
for rel in ["src/services/project-evolution/evolutionPipeline.ts", "src/services/project-evolution/evolutionPipeline.test.ts"]:
    p = base/rel
    b = p.read_bytes()
    t = b.decode("utf-8")
    nl = "\r\n" if "\r\n" in t else "\n"
    lines = t.split(nl)
    print("="*20, rel, "total", len(lines))
    for i,l in enumerate(lines,1):
        if rel.endswith("Pipeline.ts") and (i>=115 or (28<=i<=60)):
            print(i, "|", l)
        if rel.endswith("test.ts"):
            print(i, "|", l)