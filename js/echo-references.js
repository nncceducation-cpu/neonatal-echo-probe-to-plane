// Reviewed supplied cine loops, not spatially tracked sweeps or a 3D volume.
// Frame time represents cardiac motion and must never drive slice position.
export const echoReferences = {
  plax: {file:'normal-la.mp4', title:'Parasternal long axis', source:'Heart Normal - Case 1 - LA.mp4', id:'1DKiV5sh5zQsD-z8H8aggOGCSkYiTmWwo', landmarks:'Long-axis LV, mitral valve and aortic-root continuity.'},
  psax_av: {file:'normal-sa.mp4', title:'Short axis · aortic-root level', source:'Heart Normal - Case 1 - SA.mp4', id:'1I0UIvcKxSA85Y-uZJN2jL_ddGdWkWVOt', landmarks:'Central aortic-root cross-section with surrounding right-heart and atrial structures.'},
  psax_mv: {file:'short-axis.mp4', title:'Ventricular short axis · mitral-level reference', source:'ShortAxis.avi', id:'13fIpJp3Q-pF7hWva1nB3b4WxZZtNplOe', landmarks:'Circular LV cross-section with moving central valve apparatus. Level assignment is a visual-review inference; confirm clinically.'},
  psax_pap: {file:'normal-sab.mp4', title:'Ventricular short axis · papillary-level reference', source:'Heart Normal - Case 1 - SAB.mp4', id:'1mrtq3P8lajICFvIEIYURH6jBdf4gyfTQ', landmarks:'Circular LV and intracavitary muscle profiles. Level assignment is a visual-review inference; confirm clinically.'},
  a4c: {file:'normal-chambers.mp4', title:'Apical four chamber', source:'Heart Normal - Case 1 - Chambers.mp4', id:'1-bsnPjO-eZvmiREdYYav1mjobSbiChGG', reverseDepth:true, landmarks:'Both ventricles, atria and AV valves. Original recording displays the apex at the bottom; the 3D cut follows that orientation while this clip is shown.'},
};
export function referenceMatches(probe, view) {
  const d = probe.deviation(view);
  return d.plane_deg <= 1 && d.beam_deg <= 1 && d.index_deg <= 1 && d.contact_mm <= .1;
}
