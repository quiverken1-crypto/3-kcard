from PIL import Image
from pathlib import Path
root=Path('assets/ui/kit_v2'); out=root/'parts'; out.mkdir(exist_ok=True)
crops={
'corner':('frame_kit',(24,164,165,311)),
'button-red':('button_kit',(164,39,414,122)),
'button-dark':('button_kit',(164,139,414,224)),
'divider':('divider_kit',(96,383,696,420)),
'swords':('icon_kit',(3,3,211,196)),
'network':('icon_kit',(215,3,421,196)),
'helmet':('icon_kit',(423,3,623,196)),
'cards':('icon_kit',(825,3,1024,196)),
'book':('icon_kit',(2,198,207,386)),
'workshop':('icon_kit',(214,198,418,386)),
'music':('icon_kit',(620,198,819,386)),
'city':('icon_kit',(822,390,1024,567)),
}
for name,(source,box) in crops.items():
 im=Image.open(root/(source+'.webp')).convert('RGBA'); print(source,im.size,im.getextrema()[3]); im.crop(box).save(out/(name+'.webp'),quality=92)
