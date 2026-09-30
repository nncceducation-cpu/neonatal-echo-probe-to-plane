// Reviewed supplied cine loops, not spatially tracked sweeps or a 3D volume.
// Frame time represents cardiac motion and must never drive slice position.
export const echoReferences = {
  plax: {file:'normal-la.mp4', title:'Parasternal long axis', source:'Heart Normal - Case 1 - LA.mp4', id:'1DKiV5sh5zQsD-z8H8aggOGCSkYiTmWwo', landmarks:'Long-axis LV, mitral valve and aortic-root continuity.'},
  psax_av: {file:'normal-sa.mp4', title:'Short axis · aortic-root level', source:'Heart Normal - Case 1 - SA.mp4', id:'1I0UIvcKxSA85Y-uZJN2jL_ddGdWkWVOt', landmarks:'Central aortic-root cross-section with surrounding right-heart and atrial structures.'},
  psax_mv: {file:'short-axis.mp4', title:'Ventricular short axis · mitral-level reference', source:'ShortAxis.avi', id:'13fIpJp3Q-pF7hWva1nB3b4WxZZtNplOe', landmarks:'Circular LV cross-section with moving central valve apparatus. Level assignment is a visual-review inference; confirm clinically.'},
  psax_pap: {file:'normal-sab.mp4', title:'Ventricular short axis · papillary-level reference', source:'Heart Normal - Case 1 - SAB.mp4', id:'1mrtq3P8lajICFvIEIYURH6jBdf4gyfTQ', landmarks:'Circular LV and intracavitary muscle profiles. Level assignment is a visual-review inference; confirm clinically.'},
  a4c: {file:'normal-chambers.mp4', title:'Apical four chamber', source:'Heart Normal - Case 1 - Chambers.mp4', id:'1-bsnPjO-eZvmiREdYYav1mjobSbiChGG', reverseDepth:true, landmarks:'Both ventricles, atria and AV valves. Original recording displays the apex at the bottom; both teaching cuts retain that display orientation.'},
};
// Explicit assignments supplied by the instructor with the SCAN correction set.
const scan = (file,title,dopplerFile,reverseDepth=false)=>({file,title,dopplerFile,reverseDepth,source:'Supplied SCAN teaching study',landmarks:'Use the recorded anatomy as the reference; the model section is an independent teaching approximation.'});
Object.assign(echoReferences,{
 plax:scan('scan-plax.mp4','PLAX · supplied labelled study','scan-plax-doppler.mp4'),
 plax_rv_in:scan('scan-rv-inflow.mp4','PLAX · RV inflow','scan-rv-inflow-doppler.mp4'),
 plax_rv_out:scan('scan-rv-outflow.mp4','PLAX · RV outflow','scan-rv-outflow-doppler.mp4'),
 psax_av:scan('scan-psax-av.mp4','Short axis · aortic valve'),
 psax_mv:scan('scan-psax-mv.mp4','Short axis · mitral valve'),
 psax_pap:scan('scan-psax-pap.mp4','Short axis · papillary muscles'),
 a5c:{...scan('scan-a5c.mp4','Apical five chamber',undefined,true),mirrorX:true},
 sub_long:scan('scan-sub-4c.mp4','Subcostal four chamber','scan-sub-4c-doppler.mp4',true),
 sub_lvot:scan('scan-sub-lvot.mp4','Subcostal LV outflow','scan-sub-lvot-doppler.mp4',true),
 sub_rvot:scan('scan-sub-rvot.mp4','Subcostal RV outflow','scan-sub-rvot-doppler.mp4',true),
 ssn_arch:scan('scan-arch.mp4','Aortic arch · high parasternal reference'),
 high_ps_duct:scan('scan-duct.mp4','High parasternal ductal view','scan-duct-doppler.mp4'),
});
// Display only: never modify the probe, scan plane or source video. Both cut
// panels use this even when the clip is hidden (and during quiz/free probe).
// Unknown/unlinked views retain their native orientation, not an inferred flip.
export function cutOrientation(viewId, manualInvert = false) {
  const ref = echoReferences[viewId];
  return { flipX: !!ref?.mirrorX !== !!manualInvert, flipY: !!ref?.reverseDepth };
}

export function referenceMatches(probe, view) {
  const d = probe.deviation(view);
  return d.plane_deg <= 1 && d.beam_deg <= 1 && d.index_deg <= 1 && d.contact_mm <= .1;
}
