"""Rebuild the offline quote font from the SHA-pinned upstream OTF (fontTools 4.65.0)."""
from pathlib import Path
import argparse, base64, hashlib, json, zlib
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen

parser=argparse.ArgumentParser()
parser.add_argument('upstream', type=Path)
args=parser.parse_args()
original=args.upstream.read_bytes()
upstream_sha='2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b'
if hashlib.sha256(original).hexdigest()!=upstream_sha:
    raise ValueError('Upstream font hash changed; review provenance before rebuilding')
font=TTFont(args.upstream, recalcTimestamp=False)
copyrights=sorted(set(record.toUnicode() for record in font['name'].names if record.nameID==0))
codepoints=set()
for a in range(0xA1,0xF8):
    for b in range(0xA1,0xFF):
        try: codepoints.update(ord(c) for c in bytes([a,b]).decode('gb2312'))
        except UnicodeDecodeError: pass
for start,end in [(0x20,0x300),(0x2000,0x3100),(0xFF00,0xFFF0)]: codepoints.update(range(start,end))
options=subset.Options()
options.layout_features=[]
options.name_IDs=['*']
options.name_languages=['*']
options.recalc_timestamp=False
sub=subset.Subsetter(options=options)
sub.populate(unicodes=codepoints)
sub.subset(font)
names={1:'COCUDTT Quote Sans SC',2:'Regular',3:'COCUDTT-Quote-Sans-SC-1.0',4:'COCUDTT Quote Sans SC Regular',6:'COCUDTTQuoteSansSC-Regular',16:'COCUDTT Quote Sans SC',17:'Regular'}
for record in font['name'].names:
    if record.nameID in names: record.string=names[record.nameID].encode(record.getEncoding())
font['CFF '].cff.fontNames=['COCUDTTQuoteSansSC-Regular']
font['CFF '].cff.topDictIndex[0].FullName='COCUDTT Quote Sans SC Regular'
font['CFF '].cff.topDictIndex[0].FamilyName='COCUDTT Quote Sans SC'
# Use quadratic TrueType outlines: CFF subsetting in the browser font library is not
# interoperable with the independent PDF renderer. Approximation error <= 1 font unit.
builder=FontBuilder(font['head'].unitsPerEm,isTTF=True)
builder.setupGlyphOrder(font.getGlyphOrder())
builder.setupCharacterMap(font.getBestCmap())
glyph_set=font.getGlyphSet()
glyphs={}
for name in font.getGlyphOrder():
    pen=TTGlyphPen(None)
    glyph_set[name].draw(Cu2QuPen(pen,max_err=1,reverse_direction=True))
    glyphs[name]=pen.glyph()
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics(font['hmtx'].metrics)
builder.setupHorizontalHeader(ascent=font['hhea'].ascent,descent=font['hhea'].descent,lineGap=font['hhea'].lineGap)
builder.font['name']=font['name']
os2=font['OS/2']
builder.setupOS2(sTypoAscender=os2.sTypoAscender,sTypoDescender=os2.sTypoDescender,sTypoLineGap=os2.sTypoLineGap,usWinAscent=os2.usWinAscent,usWinDescent=os2.usWinDescent,usWeightClass=400)
builder.setupPost()
builder.font['head'].created=font['head'].created
builder.font['head'].modified=font['head'].modified
builder.font.recalcTimestamp=False
font=builder.font
import io
buffer=io.BytesIO()
font.save(buffer)
data=buffer.getvalue()
target=Path(__file__).resolve().parents[1]/'src'/'assets'/'fonts'
target.mkdir(parents=True,exist_ok=True)
compressed=zlib.compress(data,9)
(target/'quote-sans.base64.txt').write_text(base64.b64encode(compressed).decode('ascii')+'\n',encoding='utf8')
record={'font':'COCUDTT Quote Sans SC','version':'1.0','license':'OFL-1.1','format':'TrueType','outline_conversion':'CFF to quadratic, max error 1 font unit','upstream':'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf','upstream_sha256':upstream_sha,'font_sha256':hashlib.sha256(data).hexdigest(),'compression':'zlib','bytes':len(data),'compressed_bytes':len(compressed),'characters':len(font.getBestCmap()),'coverage':'GB2312 plus supported Latin, punctuation and fullwidth glyphs; unsupported characters must block PDF export','fontTools':'4.65.0','copyright':copyrights}
(target/'provenance.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(record,ensure_ascii=True))
