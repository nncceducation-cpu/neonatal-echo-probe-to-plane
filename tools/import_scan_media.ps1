$source = 'C:\Users\khors\Downloads\SCAN echo'
$mapping = @{
 'PLAX labled.mp4'='scan-plax.mp4'; 'LLAX doppler.mp4'='scan-plax-doppler.mp4'
 'PLAX-RV inflow labled.mp4'='scan-rv-inflow.mp4'; 'PLAX-RV inflow doppler.mp4'='scan-rv-inflow-doppler.mp4'
 'PLAX-RV ouflow labled.mp4'='scan-rv-outflow.mp4'; 'PLAX-RV ouflow doppler.mp4'='scan-rv-outflow-doppler.mp4'
 'parasternal short axis -aortic valve level labled.mp4'='scan-psax-av.mp4'
 'Parasternal short axis -mitral valve level.mp4'='scan-psax-mv.mp4'
 'parasternal short axis -papillary muscles level.mp4'='scan-psax-pap.mp4'
 'Apical 5 chambers clip.mp4'='scan-a5c.mp4'
 'Subcostal 4 chambers.mp4'='scan-sub-4c.mp4'; 'subcostal 4 chambers doppler.mp4'='scan-sub-4c-doppler.mp4'
 'subcostal long axis aortal-LV.mp4'='scan-sub-lvot.mp4'; 'subcostal long axis aortal-LV doppler.mp4'='scan-sub-lvot-doppler.mp4'
 'Subcostsal long axis RV outflow.mp4'='scan-sub-rvot.mp4'; 'Subcostsal long axis RV outflow doppler.mp4'='scan-sub-rvot-doppler.mp4'
 'high parasternal aortic arch.mp4'='scan-arch.mp4'
 'high parasternal ductal view.mp4'='scan-duct.mp4'; 'high parasternal ductal view doppler.mp4'='scan-duct-doppler.mp4'
}
foreach($item in $mapping.GetEnumerator()) {
 Copy-Item -LiteralPath (Join-Path $source $item.Key) -Destination (Join-Path "$PSScriptRoot/../assets/echo-studies" $item.Value)
}
Write-Output "$($mapping.Count) supplied media files copied without changing originals."
