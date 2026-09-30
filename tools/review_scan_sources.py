from pathlib import Path
import sys, subprocess
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,r'C:\Users\khors\Documents\Codex\echo-review-runtime')
import imageio_ffmpeg
source=Path(r'C:\Users\khors\Downloads\SCAN echo')
out=root/'docs/echo-review/scan';out.mkdir(parents=True,exist_ok=True)
files=sorted(source.glob('*.mp4'))
for batch in range(0,len(files),6):
    sheet=Image.new('RGB',(1200,700),'#101820')
    for j,file in enumerate(files[batch:batch+6]):
        target=out/(file.stem+'.png')
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-loglevel','error','-ss','0.2','-i',str(file),'-frames:v','1',str(target)],check=True)
        im=Image.open(target).convert('RGB');im.thumbnail((390,300))
        x=(j%3)*400;y=(j//3)*350
        sheet.paste(im,(x,y+35));ImageDraw.Draw(sheet).text((x+5,y+5),file.stem,fill='white')
    sheet.save(out/f'clips-{batch//6}.jpg')
poppler=r'C:\Users\khors\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe'
for page in [12,13,14,16,17,18,20,24,25,26,27,29,30]:
    subprocess.run([poppler,'-f',str(page),'-l',str(page),'-singlefile','-scale-to','1100','-png',str(source/'Cardiac SCAN.pdf'),str(out/f'page-{page}')],check=True)
