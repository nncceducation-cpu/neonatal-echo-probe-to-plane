"""Create local frame sheets for manual review; never infer view from filename."""
import sys, subprocess
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.media-tools'))
import imageio_ffmpeg
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[1]
out = root / 'docs' / 'echo-review'
out.mkdir(parents=True, exist_ok=True)
for clip in (root/'assets'/'echo-studies').glob('*'):
    if clip.suffix not in ['.mp4', '.avi']: continue
    frames = []
    for i, sec in enumerate([0, .5, 1, 1.5, 2, 3]):
        target = out / f'{clip.stem}-{i}.png'
        r = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-loglevel','error','-ss',str(sec),'-i',str(clip),'-frames:v','1',str(target)],capture_output=True)
        if target.exists():
            im=Image.open(target).convert('RGB'); im.thumbnail((400,300))
            tile=Image.new('RGB',(400,325),'#161616');tile.paste(im,((400-im.width)//2,25))
            ImageDraw.Draw(tile).text((8,6),f'{clip.stem}  {sec}s',fill='white')
            frames.append(tile)
    sheet=Image.new('RGB',(1200,650),'#161616')
    for i,frame in enumerate(frames):sheet.paste(frame,((i%3)*400,(i//3)*325))
    sheet.save(out/f'{clip.stem}-sheet.jpg')
    print(clip.name, 'review frames:',len(frames))
