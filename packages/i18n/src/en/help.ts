import type { Translation } from '../index';

/** help: English of `zh-TW/help.ts` (docs/help-plan.md). The ids a topic points to (`see`) are not translated. */
export const help: Translation = {
  // ---------------------------------------------------------------- the window
  'helpui.title': 'Help',
  'helpui.button': 'Help',
  'helpui.buttonTip': 'Help (F1): opens the help on what you are doing',
  'helpui.whatIsThis': 'What Is This?',
  'helpui.whatIsThisTip': 'Then click any button or panel to open its help (Esc to cancel)',
  'helpui.pickHint': 'Click the button or panel you want help on; Esc cancels.',
  'helpui.search': 'Search help…',
  'helpui.contents': 'Contents',
  'helpui.noResult': 'Nothing found.',
  'helpui.related': 'Related topics',
  'helpui.close': 'Close',
  'helpui.back': 'Back',
  'helpui.pressF1': 'Press F1 for more',
  'helpui.noBody': 'This topic has no detailed text yet; its short description is above.',
  'helpui.shortcut': 'Shortcut: {key}',
  'helpui.noTopic': 'There is no help for this.',
  'help.group.concept': 'Basics',

  // ---------------------------------------------------------------- concepts
  'help.conceptOverview.title': 'Getting Started',
  'help.conceptOverview.summary': '3D-Builder is a parametric 3D CAD: draw a sketch, then turn it into a solid with features.',
  'help.conceptOverview.body':
    'A typical way to work:\n\n- Click a plane (Front, Top, Right) in the tree and press Sketch on the Sketch tab to enter a sketch.\n- Draw entities, add dimensions and relations, then press Exit Sketch.\n- Select that sketch, press a command such as Extruded Boss/Base on the Features tab, set it in the left panel and press ✔.\n- Later, double-click a feature in the tree to change its values; the model rebuilds.\n\nHover over any button for a one-line description; press F1 to open this help, or press What Is This? and click any button or panel to read about it.',
  'help.conceptOverview.keywords': 'start begin tutorial workflow basics',
  'help.conceptOverview.see': 'sketch extrude concept.sketch-snaps concept.selection',

  'help.conceptSelection.title': 'Selecting',
  'help.conceptSelection.summary': 'Click faces, edges and features in the graphics area or the tree; hold Ctrl to add to the selection.',
  'help.conceptSelection.body':
    '- Click to select; in the tree a click only selects, a double-click edits.\n- Hold Ctrl and click to add to the selection or take from it.\n- In a sketch, drag on empty space to box-select.\n- When a panel waits for a face or an edge, click it in the graphics area; what you pick is listed in the panel.',
  'help.conceptSelection.keywords': 'pick multiple box select Ctrl',

  'help.conceptFeatureTree.title': 'The Tree (FeatureManager)',
  'help.conceptFeatureTree.summary': 'Lists the features of the part, in the order they were made.',
  'help.conceptFeatureTree.body':
    '- Click to select, double-click to edit a feature or a sketch.\n- Right-click to suppress, delete, show or hide.\n- A feature that fails changes its icon; the message in the status bar says why.\n- The order is the order of rebuilding: a feature uses the result of those above it.',
  'help.conceptFeatureTree.keywords': 'FeatureManager feature tree suppress delete',

  'help.conceptPropertyManager.title': 'The Panel (PropertyManager)',
  'help.conceptPropertyManager.summary': 'The panel on the left while you make or edit a feature; press ✔ to accept, ✖ to give up.',
  'help.conceptPropertyManager.body':
    '- The selection lists in the panel wait for you to click in the graphics area.\n- Press Enter to accept a value; a value may be an expression or the name of an equation variable.\n- ✔ makes the feature, ✖ gives up.\n- While the panel is open the graphics area shows the model before this feature; press ✔ to see the result (as with Shell).',
  'help.conceptPropertyManager.keywords': 'panel PropertyManager accept',

  'help.conceptSketchSnaps.title': 'Sketch Snaps and Inference',
  'help.conceptSketchSnaps.summary': 'While sketching, the cursor snaps to points, lines and edges of the model, and adds horizontal, vertical, collinear, parallel and perpendicular relations by itself.',
  'help.conceptSketchSnaps.body':
    'When the cursor is near something, it lights up, its name appears next to the cursor, and clicking makes the matching relation:\n\n- Coincident: on an existing sketch point or the origin; the two become one point.\n- Midpoint, On entity: the middle of a line, or anywhere on a line, circle or arc.\n- Horizontal to point, Vertical to point: when the cursor is level or plumb (within 5 pixels) with another sketch point (an end, a center, the origin), a gray dotted line joins them and a horizontal or vertical relation is added; lined up with two points, it snaps to where the lines cross.\n- Horizontal, Vertical: a line you draw is within 3° of horizontal or vertical from its start.\n- Collinear, Parallel, Perpendicular: a line you draw is within 3° of the direction of another line: starting on that line it is collinear (a gray dotted extension is drawn), otherwise parallel; a quarter turn away it is perpendicular; that line lights up.\n- Tangent: a line drawn from the end of an arc along its tangent; or, with the cursor near the point where a line from its start would touch a circle or arc, it snaps there and the tangent relation is added.\n- Perpendicular (foot): with the cursor near the foot of the perpendicular from the start of the line onto another line, it snaps there; the new line is perpendicular to that line and ends on it.\n- Intersection: with the cursor near where two entities cross, the new point becomes the intersection of both.\n- Quadrant point: the 0°, 90°, 180° and 270° places of a circle or arc; the new point is on the entity and level or plumb with its center.\n- Grid and angle (off by default): with the grid turned on in System Options a free point goes to a grid point; with the angle turned on the direction of a line goes to a multiple of the angle step (within 3°); holding Shift while drawing a line makes its length a multiple of the grid spacing.\n- Model end point, Model midpoint, Model center, On model edge: when you sketch on a face, the edges of that face are snapped to; clicking makes that edge an entity that follows the model (purple) and the new point coincident with it, so the sketch moves when the model changes.\n\nOrder of preference: the sketch\'s own points and midpoints first, then the model\'s ends, centers and midpoints, intersections, quadrant points, tangent places and feet of perpendiculars, then places on sketch entities, then places on model edges, and only then horizontal, vertical, collinear and the like.\n\n"Sketch snaps" in System Options turns the whole thing off (nothing snaps and no relation is added by itself), or just some of the snaps. While a drawing tool is active, right-click > Quick snaps keeps only one snap on and the others off until the tool changes or you end it.\n\nRelations added this way may make a relation you add by hand redundant; delete the automatic one from the relation list in the sketch panel.',
  'help.conceptSketchSnaps.keywords': 'snap inference dotted line horizontal to point vertical to point collinear parallel model edge magnet',
  'help.conceptSketchSnaps.see': 'sketch tool-line tool-convert',

  'help.conceptDrawingDimensions.title': 'Dimensions on a drawing',
  'help.conceptDrawingDimensions.summary': 'Linear, diameter, radius and angle dimensions on the views of a drawing; the numbers always come from the model.',
  'help.conceptDrawingDimensions.body':
    'Select a view in the drawing panel; the Dimensions section makes all of them at once (overall size, holes, where the holes are), or you choose:\n\n- Linear: the horizontal, vertical or aligned distance between two planes or circles (seen edge-on or as circles).\n- Diameter and radius: pick a circle or a hole; it can be written \"4×Ø9\", and a hole can carry a note of through or depth.\n- Angle: pick two planes seen as lines (square to the view\'s x or y, or slanted); the arc is drawn where the two lines meet, its radius can be changed (Arc radius), and \"Use the other angle\" takes the supplement. The angle is the one between the two rays that run from where the lines meet toward the middle of each face, for example the top of a block and a 45° chamfer enclose 135° (45° with the supplement). Two parallel faces have no angle, and it says so.\n\n- Each dimension can have a tolerance (limits; for linear and diameter also an ISO 286 fit) and be made a reference dimension (in parentheses).\n- The number is worked out from the model every time, so it follows when the model changes; an element that is gone is reported with the reason.',
  'help.conceptDrawingDimensions.keywords': 'dimension angle diameter radius tolerance drawing',

  // ---------------------------------------------------------------- file
  'help.newPart.summary': 'Starts an empty part with the Front, Top and Right planes.',
  'help.newPartTemplate.summary': 'Starts a new part from a template, which sets the material and document settings (blank, carbon steel, aluminium, plastic, CNS drafting).',
  'help.newAssembly.summary': 'Starts an empty assembly; then insert components and add mates.',
  'help.newDemo.summary': 'Opens a demo part to look at what features can make.',
  'help.open.summary': 'Opens a part (.3dbx) or an assembly (.3dba) file.',
  'help.save.summary': 'Saves the file; asks where when it has no name yet.',
  'help.saveAs.summary': 'Saves under a new name or place; saving an assembly elsewhere rewrites the relative paths of its parts.',
  'help.exportStep.summary': 'Writes the part or assembly as a STEP file, which other CAD programs can open.',
  'help.exportStl.summary': 'Writes the solids of the part as an STL (triangle mesh) file; the fineness follows the document\'s mesh quality.',
  'help.exportImage.summary': 'Saves what the graphics area shows as a PNG image.',
  'help.newDrawing.summary': 'Makes a drawing of a saved part or assembly (not while the file has unsaved changes).',
  'help.generateAssembly.summary': 'Writes a derived part file for each body of the part, then an assembly made of them (save the part first).',
  'help.importStepAssembly.summary': 'Reads a STEP assembly and splits it into part files and an assembly.',
  'help.returnAssembly.summary': 'Goes back from the part being edited to the assembly that opened it.',

  // ---------------------------------------------------------------- tools
  'help.equations.summary': 'Defines global variables and expressions that dimensions and feature values can use.',
  'help.appearance.summary': 'Sets the color of the part, a body, a feature or a face; a face beats a feature, then a body, then the part.',
  'help.options.summary': 'System options: interface language, autosave, the template of New Part, what can be picked at the start; kept in this browser, not in the part file.',
  'help.shortcuts.summary': 'Shows and changes the shortcut key of each command.',
  'help.measurePart.summary': 'Measures distances and angles between the points, edges and faces you pick; press again to end.',
  'help.draftAnalysis.summary': 'Analyses the draft angle of each face against the pull direction and colors the faces.',
  'help.undercutAnalysis.summary': 'Finds the faces that are blocked at both ends along the pull direction (undercuts).',
  'help.thicknessAnalysis.summary': 'Measures the wall thickness of each face along its inward normal and shows the thinnest and thickest places.',
  'help.checkPart.summary': 'Checks the geometry: whether it passes the validity check, whether the shell is closed (no open edges) and whether the volume is positive.',
  'help.physicalPart.summary': 'Sets the material and works out mass, center of mass and moments of inertia.',
  'help.properties.summary': 'Edits the file properties (part number, supplier, description…), which the bill of materials reads.',

  // ---------------------------------------------------------------- features
  'help.sketch.summary': 'Makes a sketch on the selected plane or face and enters it.',
  'help.sketch.body':
    'Click a plane in the tree (or a flat face in the graphics area), then press Sketch. In the sketch:\n\n- The left panel shows the sketch state: fully defined, under defined (N degrees of freedom left) or over defined. Blue entities are under defined, black ones fully defined, red ones in conflict.\n- Draw with the tools of the Sketch tab, dimension with Smart Dimension, and add relations to the selected entities in the panel.\n- While a sketch is edited, Equations and File Properties are gray; after leaving it, change a dimension in the "Sketch dimensions" table of the Equations window.\n- To make a feature from the sketch its outline has to be closed; "Check sketch for feature" in the panel lists open end points, and a larger gap tolerance repairs them in one click.',
  'help.sketch.keywords': 'sketch enter fully defined under defined over defined open end point gap tolerance',
  'help.sketch.see': 'exit-sketch tool-dimension concept.sketch-snaps extrude',

  'help.extrude.summary': 'Pulls the selected sketch out to a thickness and adds it to the part.',
  'help.extrude.body':
    'Select a sketch, then press this command. In the panel:\n\n- End condition: blind, mid plane, through all, up to a face, up to next, up to a vertex, up to a body, offset from a surface.\n- Reverse direction, draft (with "draft inward"), direction 2 (pull the other way too), thin feature (only a wall of the given thickness; inward, mid plane or two different thicknesses).\n- When the sketch has several closed regions, the "Selected contours" list lets you take only some of them (at least one stays).\n- Merge result: when checked it joins the bodies it touches, otherwise it is a new body.\n\nChecked examples: a 20 × 10 rectangle, depth 10, is 2000 mm³; with a 3° outward draft about 2160.89; direction 2 with depth 4 is 2800; a thin wall of 2 inward is 1040.',
  'help.extrude.keywords': 'extrude boss base end condition thin draft direction 2 through all up to next vertex body offset',
  'help.extrude.see': 'extrude-cut sketch concept.property-manager',

  'help.revolve.summary': 'Turns the sketch around a centerline and adds it to the part.',

  'help.revolve.body':
    'Select a sketch, then press this command. The sketch needs a line to turn about (usually a centerline), with the profile drawn on one side of it.\n\n- Axis: the list holds the lines of the sketch (centerlines and ordinary lines).\n- Type: a given angle (turned from the sketch plane in one direction) or mid plane (the angle is shared between the two sides); "Reverse direction" turns the other way.\n- The angle is 360° at first; less than 360° gives a part of the turn.\n- The thin feature, the selected contours and "Merge result" work as they do for an extrusion.\n- A profile that is not closed makes the feature fail with the reason (no closed profile to turn).\n\nWorked by hand: a rectangle 10 wide and 20 high with one side on the axis, turned 360°, is a cylinder of radius 10 and height 20: π × 10² × 20 = 6283.19 mm³; turned 90° it is a quarter of that, 1570.80 mm³.',

  'help.revolve.keywords': 'revolve boss base centerline axis angle lathe turn',

  'help.revolve.see': 'revolve-cut sketch extrude concept.property-manager',
  'help.sweep.summary': 'Sweeps a profile sketch along a path drawn in another sketch and adds it to the part.',

  'help.sweep.body':
    'First draw two sketches: the profile (one closed outline) and the path (one connected open chain of lines and arcs, one end of which lies on the plane of the profile). Select the profile sketch, press this command, and choose the path sketch in the panel.\n\n- The sweep starts at the end of the path that lies on the profile plane, and the angle between profile and path stays the same.\n- When the profile has holes, the result is the outline swept less the holes swept (a pipe is two concentric circles).\n- "Selected contours" and "Merge result" work as they do for an extrusion.\n- A closed path cannot be used (the volume comes out as 0) and it says why; a result that is not a valid solid is explained too.\n\nWorked by hand: a profile of 4 × 6 and a straight path of 40: 24 × 40 = 960 mm³; a path of a line of 30, a quarter arc of R10 and a line of 20 up, the profile on the path: 24 × (30 + 15.708 + 20) = 1577.0 mm³ (the area of the profile times the length of the path).',

  'help.sweep.keywords': 'sweep profile path pipe tube bend',

  'help.sweep.see': 'sweep-cut sketch loft',
  'help.loft.summary': 'Makes a shape that changes from one profile sketch to the next, and adds it to the part.',

  'help.loft.body':
    'First sketch a section on each of several planes (one closed outline each, without holes), select the first, press this command, and add the others in order with "Add section…".\n\n- The list of sections runs from the first to the last; "Move up", "Move down" and "Remove" change it.\n- The faces pass smoothly through all the sections; with two sections they are ruled.\n- Where the outlines start and which way they run need not match; the kernel pairs them.\n- The sections may have different numbers of edges (a square to a circle works).\n- A result that is not a valid solid makes the feature fail with the reason.\n\nWorked by hand: two 10 × 6 rectangles 20 apart make a prism of 1200 mm³; 20 × 20 to 10 × 10 over 20 is a pyramid frustum (20/3) × (400 + 200 + 100) = 4666.67 mm³; a circle of radius 5 to a circle of radius 2 over 20 is a cone frustum π × 20/3 × (25 + 10 + 4) = 816.81 mm³.',

  'help.loft.keywords': 'loft sections frustum transition blend',

  'help.loft.see': 'loft-cut sweep sketch',
  'help.rib.summary': 'Grows a rib of the given thickness from a sketch line, in the middle of the line or to one side.',

  'help.rib.body':
    'Draw one straight line in a sketch, select the sketch and press this command: the line, given a thickness, becomes a wall that grows from the line, in the plane of the sketch and square to the line, as far as the body, and joins it.\n\n- Rib thickness; "Thickness position": both sides (about the sketch plane), one side of the sketch normal, or the other.\n- "Reverse direction" changes the way the wall grows. The program does not choose the direction: when the wall cannot reach the body it says to reverse.\n- Put the sketch on a plane square to the plate; the position of the line is the top edge of the rib.\n\nWorked by hand: a plate of 40 × 40 × 10, the line 15 above the plate, 20 long, thickness 4: 16000 + 15 × 20 × 4 = 17200 mm³.',

  'help.rib.keywords': 'rib web gusset reinforcement thickness reverse',

  'help.rib.see': 'extrude sketch concept.property-manager',
  'help.extrudeCut.summary': 'Pulls the selected sketch out and removes it from the part.',

  'help.extrudeCut.body':
    'Select a sketch, then press this command. It works like Extruded Boss/Base, except the shape that is pulled out is taken away from the part.\n\n- A cut goes into the material by default (against the sketch normal); tick "Reverse direction" to go the other way.\n- The end conditions, draft, direction 2, thin feature and the selected contours work as they do for an extrusion.\n- Through all cuts all the way through; a given depth cuts only that deep.\n\nWorked by hand: a 40 × 30 × 10 block, a 10 × 10 square sketched on the top face and a depth of 4: 12000 − 400 = 11600 mm³; through all: 12000 − 1000 = 11000 mm³.',

  'help.extrudeCut.keywords': 'cut extruded cut remove through all depth slot pocket',

  'help.extrudeCut.see': 'extrude sketch hole concept.property-manager',
  'help.revolveCut.summary': 'Turns the sketch around a centerline and removes it from the part.',

  'help.revolveCut.body':
    'Select a sketch, then press this command. It works like Revolved Boss/Base, except the revolved shape is taken away from the part; use it for grooves, cone-shaped holes and shoulders.\n\n- The axis, the type, the angle and "Reverse direction" work as they do for a revolved boss.\n- The revolved shape has to touch the part to cut anything.\n\nWorked by hand: a cylinder of radius 10 and height 20 (6283.19 mm³), a rectangle 5 wide and 20 high sketched against the axis and turned 360° as a cut leaves a tube with a bore of radius 5: π × (10² − 5²) × 20 = 4712.39 mm³.',

  'help.revolveCut.keywords': 'revolve cut groove bore lathe remove',

  'help.revolveCut.see': 'revolve extrude-cut sketch concept.property-manager',
  'help.sweepCut.summary': 'Sweeps the profile along the path and removes it from the part.',

  'help.sweepCut.body':
    'Works like Swept Boss/Base (one profile sketch, one path sketch), except the swept shape is taken away from the part; use it to cut a curved slot or hole.\n\n- One end of the path has to lie on the plane of the profile; the sweep starts there.\n- The swept shape has to touch the part to cut anything.\n- A profile with holes: the shape swept by the outline, less the shape swept by the holes, is what is removed.',

  'help.sweepCut.keywords': 'swept cut remove path curved slot',

  'help.sweepCut.see': 'sweep loft-cut extrude-cut',
  'help.loftCut.summary': 'Makes a shape between two or more profiles and removes it from the part.',

  'help.loftCut.body':
    'Works like Lofted Boss/Base (sections added in order), except the shape is taken away from the part.\n\n- Each section is one closed outline of a sketch, without holes; the list of sections can be put in order.\n- The lofted shape has to touch the part to cut anything.',

  'help.loftCut.keywords': 'loft cut remove sections',

  'help.loftCut.see': 'loft sweep-cut extrude-cut',
  'help.fillet.summary': 'Rounds the selected edges, or the edges of the selected faces.',
  'help.fillet.body':
    'Click the edges or faces to round in the graphics area (as many as you like), type the radius in the panel and press ✔. Clicking a selected one takes it away.\n\n- Pick an edge: only that edge is rounded (with the edges that continue it smoothly).\n- Pick a face: all its edges are rounded, the edges of its holes too; edges that are smooth already and the seam of a cylinder are left alone. Edges the face gets later (a slot cut into it, say) are rounded too, because each rebuild works the edges out from the face.\n- Both can be used together; an edge is rounded once.\n- When the face has no edge that can be rounded, the feature fails and says why.\n\nWith the fillet type "Face fillet" you pick no edges but two groups of faces (face set 1 and 2: choose the set first, then click faces in the graphics area); the edges where the two sets meet are rounded, convex ones take material away and concave ones (the inside corner of an L, say) add it. When the two sets share no edge the feature fails and says so (a fillet between faces that do not meet is not made yet).\n\n"Full round fillet": pick two side face sets and a center face (choose the set first, then click faces in the graphics area); the center face is replaced by a half cylinder tangent to both sides, whose radius is half the distance between the sides and is not typed. The sides have to be parallel and square to the center face, the center face a rectangle and the sides not lower than the radius; otherwise the feature fails and says why. The new cylindrical face keeps the name of the center face.\n\nChecked examples: a 40 × 30 × 12 block, the top face, radius 2: 14282.89 mm³ (the same as picking its 4 edges; the corners are mitred); the top and the bottom: 14165.78; a radius 1.5 round on the top of a cylinder agrees with the hand calculation; face fillet: the top and one side (the edge 30 long), radius 2: 14374.25, the inside corner of an L with radius 3 adds 77.26; full round: a 40 × 30 × 20 block with the top between the front and the back: 20137.17 mm³ (radius 15).',
  'help.chamfer.summary': 'Bevels the selected edges, or the edges of the selected faces.',
  'help.chamfer.body':
    'Select the edges or faces to chamfer, choose angle-distance or distance-distance, type the values and press ✔.\n\n- With a face, the first distance is measured on the face you picked (the second on the face on the other side of the edge); "Reverse direction" swaps them. With the top face and distances 3 and 1: the top shrinks by 3 and the sides are cut 1 down; reversed, the top shrinks by 1 and the sides are cut 3.\n- With an edge, the first distance is measured on the adjacent face whose name sorts first ("Reverse direction" takes the other).\n- A face stands for all its edges, except smooth ones and seams, and for the edges it gets later.\n\nChecked example: a 40 × 30 × 12 block, the top face chamfered 2 × 2: 14130.67 mm³.',
  'help.deleteFace.summary': 'Deletes the selected faces and extends the faces around them until they meet; often used to take out holes or fillets.',

  'help.deleteFace.body':
    'Click the faces to delete (several; click again to take one off) and press ✔: the faces around them extend to close the gap, so holes and fillets vanish.\n\n- While editing, the view shows the model before this feature; clicking a face adds or removes it.\n- Tick "Delete holes" to delete with them the faces that only they enclose (the bottom of a blind hole, for instance).\n- It is for imported models (which have no feature history), to take out holes and fillets; in a part of your own it is better to delete the feature that made them.',

  'help.deleteFace.keywords': 'delete face remove hole fillet imported direct edit',

  'help.deleteFace.see': 'move-face fillet import-step',
  'help.hole.summary': 'Drills holes at the points of a sketch: straight, counterbore, countersink, tapped or dowel pin; diameter and depth are set in the panel.',

  'help.hole.body':
    'First sketch on the face to be drilled, with "single points" (not the ends of lines or the centers of circles) where the holes go; select that sketch and press this command. A hole is drilled at every single point of the sketch, into the material.\n\n- Kind of hole: straight, counterbore, countersink, tapped (the drilled hole), dowel.\n- Standard size: pick a size and the diameters come from the table (a tapped hole is drilled to the tap size, the others to the clearance); pick "Custom" to type the diameter. Check the table values against your company standard.\n- A counterbore needs a counterbore diameter and depth; a countersink a countersink diameter and an angle (90° at first); the counterbore has to be bigger than the hole and shallower than it is deep, otherwise the feature fails with the reason.\n- Depth: a given depth or through all; the direction can be reversed.\n- Dowel hole: give the nominal diameter, the tolerance grade (for example H7) and the entry chamfer; the hole is made at the nominal diameter, and the panel lists the limits of the hole and of the pin that goes with it.\n\nExample: an H7 dowel hole of Ø6 has the limits 6.000 to 6.012 mm (+0.012 / 0). When there is no material at the place of a point (the hole is outside the body, or the direction is wrong) the feature fails and says which point.',

  'help.hole.keywords': 'hole wizard counterbore countersink tapped dowel drill tolerance H7',

  'help.hole.see': 'sketch extrude-cut concept.property-manager',
  'help.screwBoss.summary': 'Grows screw bosses with a hole at the points of a sketch, with draft and ribs as options.',

  'help.screwBoss.body':
    'Makes a screw boss at every free point of the sketch, growing from the face the sketch is on (for example the inside floor of a shell) along its normal; the hole goes down from the top.\n\n- Outside diameter, hole diameter (the pilot hole, the diameter at the mouth; look up the screw\'s specification for a self-tapping screw), height, hole depth (blank = to the bottom).\n- Draft of the outside wall (narrowing to the top, blank = none); the hole can have its own draft (narrowing to the bottom, so that the core pin can be drawn out); "Same as outside" sets the two alike.\n- Ribs (gussets): triangular pieces at the foot; set the number, the rib thickness, how far out, the rib height and the start angle (0° is the x of the sketch), spread evenly; "Remove ribs" takes them away.\n- The boss sinks a little into the body, so it always joins; when it does not reach the body the feature fails. When the floor thickness of the shell is changed the bosses follow.',

  'help.screwBoss.keywords': 'screw boss pilot hole rib draft plastic',

  'help.screwBoss.see': 'shell draft snap-hook',
  'help.baseFlange.summary': 'Makes the base of a sheet metal part from a sketch: a closed outline is a flat plate, an open polyline a bent one.',

  'help.baseFlange.body':
    'The first feature of a sheet metal part: select a sketch and press this command. It also holds the sheet metal settings of the whole part.\n\n- A closed profile is a flat plate; an open polyline is a bent plate (a U, for example), the corners rounded automatically.\n- Thickness, bend radius (inside), K factor (how far from the inside the layer that keeps its length lies, 0 to 1, 0.5 at first).\n- Width (open profile): the width of the bent plate (50 at first). "Thickness to the other side" turns the way the thickness grows: the polyline of a bent plate is the outside face at first, and the inside face once it is turned.\n- The flat length of a bend is the straight part + the bend allowance; the bend allowance = the angle (in radians) × (inside radius + K × thickness).\n\nVerified examples (thickness 1.5, bend radius 2): a closed profile of 60 × 40 is a plate of 60 × 40 × 1.5 = 3600 mm³; a U channel (60 outside wide, 20 outside high, 40 long) is 5678.3 mm³, the panel says a flat length of 94.639, and K = 0.4 gives 94.168.',

  'help.baseFlange.keywords': 'sheet metal base flange thickness bend radius k factor flat length bend allowance',

  'help.baseFlange.see': 'edge-flange hem flat-pattern sketch',
  'help.edgeFlange.summary': 'Folds a flange up from an edge of a sheet metal plate, with length, angle and bend radius.',

  'help.edgeFlange.body':
    'Grows a bend and a flat flange on a straight edge of a sheet metal plate, as wide as the whole edge.\n\n- Click an edge of the plate in the view (clicking a face does nothing). The flange folds to the side of the face the edge you clicked belongs to; "Flip to the other side" changes it.\n- Flange length, measured from the outside virtual sharp at first (the outside size on a drawing); it can also be measured from the inside virtual sharp or after the bend.\n- Bend angle (blank = 90°) and bend radius (blank = that of the base).\n- Position: "Material inside" (the outside is flush with the edge and the plate is cut away near the edge) or "Bend outside" (the bend starts at the edge, the plate does not move).\n- The start and the end can be shortened, with a rectangular relief cut at the shortened end, so that flanges on neighboring edges do not touch at the corner.\n\nVerified example: a plate 100 × 50 × 1.5 (7500 mm³), bend radius 2, 90°, length 30 from the outside, material inside: the plate loses 262.5, the bend is 323.98 and the flat is 1987.5, in all 9548.98 mm³.',

  'help.edgeFlange.keywords': 'sheet metal edge flange bend length angle relief inset',

  'help.edgeFlange.see': 'base-flange hem flat-pattern concept.property-manager',
  'help.hem.summary': 'Folds the edge of a sheet metal plate back on itself (a 180° bend).',

  'help.hem.body':
    'Makes a 180° bend on a straight edge of a sheet metal plate, a part of the plate folded back over the plate.\n\n- Click an edge of the plate in the view; "Return length (after the bend)" is the length of the flat that is folded back.\n- "Gap between the two layers (inside)" is the distance between the inside faces of the two layers, and the inside radius of the bend is half of it; a closed hem is a small gap (the gap cannot be 0: a bend with no inside has no shape).\n- Position: "Material inside" (the outside is flush with the edge) or "Bend outside".\n- Shortening the start and the end and the reliefs work as for an edge flange; a hem can also go on the end of a flange as a returned lip.\n\nVerified example: a plate 100 × 50 × 1.5, a gap of 1 (inside bend radius 0.5), a return of 10, material inside: 8394.52 mm³ (the plate loses 150, the bend is 294.52, the flat 750); with the bend outside: 8544.52 mm³.',

  'help.hem.keywords': 'sheet metal hem fold back 180 gap closed lip',

  'help.hem.see': 'edge-flange base-flange flat-pattern',
  'help.flatPattern.summary': 'Works out the flat pattern (the unfolded plate), bend lines and a bend table of a sheet metal part, and writes it as DXF.',

  'help.flatPattern.body':
    'Works out the flat pattern (the unfolded sheet) of a sheet metal part and draws the outline and the bend lines (red dashed) in a window. The part needs a base flange, otherwise it says "This part is not sheet metal".\n\n- The window lists the overall size, the area, the thickness, the volume and the bend table (angle, inside radius, direction "up / down", bend allowance, position).\n- "Export DXF" writes the outline and the bend lines to a DXF file.\n- The flat pattern is worked out from the bend data (the solid is not unfolded); the window follows when the model changes; nothing is saved in the file.\n- An edge flange or hem on a flange of a bent base flange cannot be unfolded yet; it says why.\n\nVerified example (plate 100 × 50 × 1.5, radius 2, K 0.5): add a flange of 90°, length 30 from the outside, material inside, and the flat length is 100 − 2 × (2 + 1.5) + 30 + 4.3197 = 127.3197, the width 50, the area 6365.98, one bend of 90° up; K = 0.4 gives 127.0841; the volume unfolded is that of the folded part (K = 0.5).',

  'help.flatPattern.keywords': 'sheet metal flat pattern unfold bend line bend table dxf allowance',

  'help.flatPattern.see': 'base-flange edge-flange hem',
  'help.snapHook.summary': 'Makes a snap hook on a plastic part: a cantilever beam with a wedge-shaped hook.',

  'help.snapHook.body':
    'Makes a cantilever beam at every free point of the sketch, growing from the face the sketch is on along its normal; the end of the beam has a wedge-shaped hook sticking out along the angle: flat underneath (the face that catches), sloped on top (the lead-in).\n\n- Width, beam thickness (along the angle), beam length, hook height, hook depth (how far it sticks out).\n- The beam sinks a little into the body, so it always joins.\n- The sizes are typed by hand; the program does not work out the strain of the beam or choose the material and the angle for you.\n- Cut the other half with "Snap catch" (a window).',

  'help.snapHook.keywords': 'snap hook cantilever beam latch plastic',

  'help.snapHook.see': 'snap-catch vent screw-boss',
  'help.snapCatch.summary': 'Makes the rectangular window a snap hook catches on in a plastic part.',

  'help.snapCatch.body':
    'Cuts a rectangular window at every free point of the sketch, for the hook of a snap hook to catch in.\n\n- It cuts the "cut depth" into the body from the face the sketch is on; the depth has to be more than the wall to go through.\n- The sizes are typed by hand: the width of the hook and how far it sticks out, plus the clearance the process needs.\n- In the opening direction of the shell the undercut analysis finds this window (it is an undercut), so the mold needs a slider or a hand-loaded core.',

  'help.snapCatch.keywords': 'snap catch window latch undercut',

  'help.snapCatch.see': 'snap-hook vent undercut-analysis',
  'help.vent.summary': 'Makes a row of vent slots in a face of a plastic part.',

  'help.vent.body':
    'Cuts a row of slots at every free point of the sketch, for the vents of a housing.\n\n- The number of slots, the pitch (center to center), the size of the slots and the angle; the row is centered on the point and the long side of a slot runs along the angle; the slots can have round ends.\n- It cuts the "cut depth" into the body from the face the sketch is on; the depth has to be more than the wall to go through, but it also cuts into the walls behind, so do not go much beyond.',

  'help.vent.keywords': 'vent slots ventilation housing cut',

  'help.vent.see': 'snap-catch shell sketch',
  'help.draft.summary': 'Tilts the selected faces by a draft angle about a neutral face.',
  'help.draft.body':
    'Click the neutral face first, then the faces to draft, type the draft angle and press ✔. Away from the neutral face the walls narrow by default; with "Reverse draft direction" they widen the farther they are from it.\n\nChecked example: a 20 × 10 × 10 block with the top face as the neutral face and its four sides drafted 3° is about 1846.44 mm³; reversed, about 2160.89 mm³. Three of the sides can only be picked after turning the view.',
  'help.draft.keywords': 'draft pull neutral face angle',
  'help.shell.summary': 'Hollows the solid out to a thin wall, with the faces you pick as openings.',
  'help.shell.body':
    'Click the faces to remove, type the wall thickness and press ✔ (while editing, the view is the model before the shell; press ✔ to see the result).\n\n- Walls go inward by default; check "Shell outward" to go outward.\n- "Faces with a different thickness" gives single flat walls their own thickness.\n- A wall thicker than the shape allows (for example more than half the side of a block) makes the feature fail with "The wall is thicker than this shape allows…"; make it smaller and it recovers.\n\nChecked example: a 40 × 30 × 10 block with its top face open and a wall of 2 inward is 4512 mm³; outward, 5952 mm³.',
  'help.shell.keywords': 'shell hollow wall thickness opening outward',
  'help.moveFace.summary': 'Pushes the selected flat face by a distance and extends the faces around it, to edit an imported model directly.',

  'help.moveFace.body':
    'Click a planar face, type the "distance" and press ✔: the face moves along its outward normal and the neighboring faces extend or shorten with it; it is for editing imported models directly.\n\n- A negative value goes into the material.\n- Slanted faces keep their slope.\n- Faces tangent to it (fillets, for example) have to be dealt with first; otherwise the feature fails and says why.',

  'help.moveFace.keywords': 'move face direct edit imported distance',

  'help.moveFace.see': 'delete-face fillet import-step',
  'help.offsetSurface.summary': 'Offsets the selected faces by a distance into a surface body.',
  'help.splitLine.summary': 'Projects the closed outer loop of a sketch onto a face and splits the face into regions.',
  'help.knit.summary': 'Sews surfaces together into one surface body or a solid.',
  'help.fillSurface.summary': 'Patches a surface across a loop of edges.',
  'help.flatSurface.summary': 'Patches a flat surface across a closed loop of edges.',
  'help.trimSurface.summary': 'Cuts regions in a surface with a sketch and keeps one side.',
  'help.extendSurface.summary': 'Extends the edges of a surface body by a distance.',
  'help.thicken.summary': 'Gives a surface body a thickness and makes it a solid.',
  'help.cutWithSurface.summary': 'Uses a surface as a knife to cut one side away from a solid.',
  'help.lipGroove.summary': 'Makes a lip or a groove along the outline in a face of a plastic part, so that two halves fit together.',

  'help.lipGroove.body':
    'Makes a ring along the outer outline of a face (usually the rim of a shell), as a lip or a groove, for a lid to fit.\n\n- Which face it goes on: click a planar face.\n- Kind: a lip (grows out from the face by the "height") or a groove (cut into the body by the "depth").\n- Offset from the edge and the width of the ring: the outline is offset inward by "offset" and by "offset + width", and the ring lies between the two lines.\n- The ring has to lie wholly on the face and not cover a hole in it, so the rim of the shell has to be wide enough; otherwise the feature fails and says why.\n- The groove in the lid is the same feature, with the width and depth enlarged by the clearance of the fit.',

  'help.lipGroove.keywords': 'lip groove lid fit shell rim',

  'help.lipGroove.see': 'shell draft snap-hook',
  'help.combine.summary': 'Adds bodies, subtracts them (the main body minus the tool bodies) or keeps what they share.',

  'help.combine.body':
    'Combines several bodies into one: choose the "main body" and the "bodies to combine", then the kind.\n\n- Add: bodies that touch are merged into one.\n- Subtract: the main body less the other bodies (the tools).\n- Common: only the part where the bodies overlap (the intersection) is kept.\n- The result is the main body and the others are used up. Click the faces of bodies in the view to add or remove them; adding needs the bodies to touch, subtracting and common take the main body\'s relation to them.',

  'help.combine.keywords': 'combine bodies add subtract common intersect boolean',

  'help.combine.see': 'mirror extrude concept.property-manager',
  'help.linearPattern.summary': 'Repeats the selected features along one or two directions.',

  'help.linearPattern.body':
    'Copies the selected features along one or two directions.\n\n- Features to pattern: tick one feature, or several one after the other (sketches and datums may lie between); what is patterned is the material they add to and take from the body.\n- Direction 1: a straight edge, a datum axis or a plane (its normal); give the spacing and the number of instances (the original counts as one); "Reverse direction" goes the other way.\n- "Add direction 2 (a grid)" adds another direction, making a grid of rows × columns.\n- Instances to skip: press an instance to leave it out, press again to bring it back; number 0 is the original, in a grid they are "row × column".\n\nExample: one hole patterned 3 times at 15 mm puts the holes at 0, 15 and 30 mm; a 3 × 2 grid is 6 holes, 5 with one skipped.',

  'help.linearPattern.keywords': 'linear pattern array spacing instances grid skip copy',

  'help.linearPattern.see': 'circular-pattern mirror hole concept.property-manager',
  'help.circularPattern.summary': 'Repeats the selected features around an axis.',

  'help.circularPattern.body':
    'Copies the selected features round an axis.\n\n- Features to pattern: tick one feature, or several one after the other.\n- Axis: a straight edge, a datum axis, a cylindrical or conical face (its axis).\n- The angle and the number of instances (the original counts as one); with "Equal spacing (the angle is shared by the instances)" the angle is the total, shared by all the instances. "Reverse direction" turns the other way.\n- Instances to skip: press one to leave it out, press again to bring it back.\n\nExample: one hole patterned 6 times about the center axis, equal spacing, 360°, puts a hole every 60°; 4 times at 360° is every 90°.',

  'help.circularPattern.keywords': 'circular pattern array round axis angle instances',

  'help.circularPattern.see': 'linear-pattern mirror hole concept.property-manager',
  'help.mirror.summary': 'Mirrors the selected features or bodies about a plane.',

  'help.mirror.body':
    'Mirrors features, or a whole body, to the other side of a plane.\n\n- What to mirror: "Features" (the material they add to and take from the body) or "Bodies" (an image of the whole body).\n- Mirror plane: a datum plane or a planar face of the model.\n- "Merge result": the mirrored body joins the bodies it touches (the original too); without it the mirror is a new body.\n\nExample: a 10 × 10 × 10 block lying against the mirror plane (x = 0), its body mirrored in the right plane and merged: one solid of 20 × 10 × 10, 2000 mm³.',

  'help.mirror.keywords': 'mirror symmetry plane body feature merge',

  'help.mirror.see': 'linear-pattern circular-pattern concept.property-manager',
  'help.refPlane.summary': 'Makes a reference plane (offset, angle, three points, parallel…).',

  'help.refPlane.body':
    'Makes a datum plane for reference: to sketch on, to mirror in, or to end an extrusion at.\n\n- Kinds: offset (a distance from a reference plane), angle (0° is parallel to the reference, 90° square to it), three points (click vertices or reference points), parallel (through a point, parallel to a reference), perpendicular (through a point, square to a straight edge or datum axis), midplane (midway between two parallel faces), tangent (tangent to a cylinder and parallel to a reference; "Reverse direction" goes to the other side of the cylinder).\n- The reference can be a planar face in the view, or one of the datum buttons in the panel (front, top, right).\n- The datum plane follows the model: when the face it refers to changes, the plane moves with it.',

  'help.refPlane.keywords': 'datum plane reference geometry offset angle midplane tangent',

  'help.refPlane.see': 'ref-axis ref-point coord-sys',
  'help.refAxis.summary': 'Makes a reference axis.',

  'help.refAxis.body':
    'Makes a datum axis, to turn about, to pattern along, or as the axis of a circular pattern.\n\n- Kinds: straight edge (the axis runs along the edge you select), two points (through two vertices or reference points, directed from the first to the second), cylindrical or conical face (the axis of the face), two planes (the line where two planes meet).\n- Two parallel planes have no line of meeting; the feature fails and says so.\n- The axis follows the elements it refers to.',

  'help.refAxis.keywords': 'datum axis edge two points cylinder planes reference geometry',

  'help.refAxis.see': 'ref-plane ref-point circular-pattern',
  'help.refPoint.summary': 'Makes a reference point.',

  'help.refPoint.body':
    'Makes a reference point, for the points of a three-point datum plane, the ends of a datum axis, or places to measure.\n\n- Kinds: coordinates (X, Y, Z from the part origin, expressions allowed), center (the center of a circular edge, the midpoint of a straight edge, the center of a sphere, the center of any other face), axis and plane (where a datum axis or a straight edge passes through a plane).\n- An axis parallel to the plane has no point of crossing; the feature fails and says so.',

  'help.refPoint.keywords': 'reference point coordinates center midpoint intersection',

  'help.refPoint.see': 'ref-plane ref-axis coord-sys',
  'help.coordSys.summary': 'Makes a coordinate system, which can place the part when exporting STEP.',

  'help.coordSys.body':
    'Makes a coordinate system, which can be chosen as the origin and the directions when exporting STEP.\n\n- Origin: pick a vertex or reference point; without one it is the part origin.\n- The X axis runs along the direction you select (a straight edge, a datum axis or the normal of a plane); Y is the part of the selected direction square to X; Z = X × Y (always right-handed).\n- "Flip X axis" and "Flip Y axis" change the directions.\n- When X and Y are parallel Z cannot be decided; the feature fails and says so.',

  'help.coordSys.keywords': 'coordinate system origin step export direction right-handed',

  'help.coordSys.see': 'ref-plane export-step ref-point',
  'help.importStep.summary': 'Reads a STEP file as the body of the part, repairing it only when needed.',

  // ---------------------------------------------------------------- assembly
  'help.insertComponent.summary': 'Inserts a part file into the assembly as a component.',
  'help.mate.summary': 'Fixes the position of components relative to each other with mates (coincident, parallel, perpendicular, concentric, distance…).',
  'help.moveComponent.summary': 'Moves a component by dragging or by typing values.',
  'help.rotateComponent.summary': 'Rotates a component.',
  'help.explode.summary': 'Makes an exploded view: moves components apart along directions; it only changes the display, not where they are assembled.',
  'help.measureAssembly.summary': 'Measures distances and angles between the elements you pick in the assembly.',
  'help.clearance.summary': 'Checks that the smallest gap between components is large enough.',
  'help.interference.summary': 'Finds the volume where components overlap (touching does not count).',
  'help.interference.body':
    'Assembly > Interference Detection: the window lists each pair of components that share volume and how much, and the overlap is red in the 3D view; click a pair in the table to show only those two components, click again to show all.\n\n- By default the unit is the top-level component: a sub-assembly counts as one, and every copy of a pattern or mirror counts on its own.\n- Check "Also check the parts inside sub-assemblies" and every part counts on its own, so the parts inside a sub-assembly are compared with each other too; they are named "sub-assembly › part", and parts of one name in a sub-assembly are told apart by <2>, <3>.\n- Touching is not interference, and an overlap under 0.001 mm³ is not reported. Hidden components are checked, suppressed ones are not. After the model changes the window says so; press Check again.\n\nChecked example: the two sub-assemblies of the golden fixture, each with a locating plate and two pins whose shanks (radius 5) stand in the holes (radius 4) of the plate: checked inside, 4 pairs of about 405.4 mm³ each, 1621.6 in all; not checked inside, none.',
  'help.interference.keywords': 'interference overlap collision sub-assembly inside volume',
  'help.checkAssembly.summary': 'Checks that the geometry of the assembly is valid.',
  'help.physicalAssembly.summary': 'Works out mass, center of mass and moments of inertia of the assembly.',
  'help.bom.summary': 'Makes the bill of materials (quantity, part number, supplier); can be written as CSV.',
  'help.patternLinear.summary': 'Repeats components along a direction.',
  'help.patternCircular.summary': 'Repeats components around an axis.',
  'help.mirrorComponent.summary': 'Mirrors components.',
  'help.fixComponent.summary': 'Holds the component where it is, whatever the mates say.',
  'help.floatComponent.summary': 'Lets a fixed component be moved by mates and by dragging.',

  // ---------------------------------------------------------------- sketch
  'help.construction.summary': 'Switches the selected entities to construction geometry (dashed, not part of the outline).',

  'help.construction.body':
    'Switches the selected sketch elements to construction geometry (dashed): they help to position things, but they are not part of the outline and are not extruded.\n\n- Select elements, then press; when all of them are construction lines already, one press turns them back into ordinary lines.\n- A centerline (the axis of a revolve) is construction geometry too.',

  'help.construction.keywords': 'construction geometry dashed centerline helper line',

  'help.construction.see': 'sketch exit-sketch revolve',
  'help.exitSketch.summary': 'Leaves the sketch, keeping the changes, and goes back to making features.',

  'help.exitSketch.body':
    'Leaves the sketch: the changes are saved and you are back at designing features; the feature tree gains a row for the sketch.\n\n- The green ✔ in the corner of the 3D window does the same.\n- To take back what you did in the sketch, use Undo.',

  'help.exitSketch.keywords': 'exit sketch finish confirm',
  'help.exitSketch.see': 'sketch',
  'help.toolLine.summary': 'Draws a line: click the start, click the end; keep going for a chain, Esc or a double-click ends it.',
  'help.toolLine.body':
    '- The start can snap to sketch points, the origin and the edges and vertices of the model; next to the cursor you see what it is (coincident, midpoint, model end point…).\n- A line within 3° of horizontal or vertical gets a horizontal or vertical relation; one in the direction of another line gets collinear, parallel or perpendicular; one drawn from the end of an arc along its tangent gets tangent.\n- When the cursor is level or plumb (within 5 pixels) with another sketch point, a gray dotted line appears and the alignment relation is added.\n- Drawing back to the first point closes the chain and ends it.',
  'help.toolLine.see': 'concept.sketch-snaps',
  'help.toolCenterline.summary': 'Draws a centerline (construction geometry), which can be an axis of revolution or a mirror line.',
  'help.toolRect.summary': 'Draws a rectangle from two opposite corners; its sides get horizontal and vertical relations.',
  'help.toolCenterRect.summary': 'Draws a rectangle from its center and a corner.',
  'help.toolCircle.summary': 'Draws a circle: click the center, then the radius.',
  'help.toolPerimeterCircle.summary': 'Draws a circle through three points on its circumference.',
  'help.toolArc.summary': 'Draws an arc from its center, start and end.',
  'help.toolTangentArc.summary': 'Draws an arc tangent to a line or arc at its end point.',
  'help.toolThreePointArc.summary': 'Draws an arc from its start, end and a point on it.',
  'help.toolPoint.summary': 'Places a point.',
  'help.toolDimension.summary': 'Dimensions: pick one or two entities, click to place, type the value and press Enter.',
  'help.toolDimension.body': '- Pick a line for its length; a circle for its diameter and an arc for its radius (arc length: "Dimension arc length" in the panel); two lines for the angle; two points for the distance.\n- A dimension that would over-define the sketch becomes a driven dimension, shown in gray italics in parentheses, only showing what is measured; the dimension list in the panel can switch it between driven and driving.\n- Double-click a dimension to change it; the box takes an expression or an equation variable.',
  'help.toolSlot.summary': 'Draws the outline of a slot from two centers and a width.',
  'help.toolPolygon.summary': 'Draws a regular polygon; the number of sides and inscribed or circumscribed are set in the panel.',
  'help.toolSketchFillet.summary': 'Rounds the corner of two lines (sketch fillet).',
  'help.toolSketchChamfer.summary': 'Bevels the corner of two lines (sketch chamfer).',
  'help.toolTrim.summary': 'Trims: click a piece of a line between crossings to remove it.',
  'help.toolExtend.summary': 'Extends: click the end of a line to lengthen it up to the line in its way.',
  'help.toolOffset.summary': 'Offsets the selected entities to one side by a distance.',
  'help.toolOffset.body': 'Select the lines to offset, then press this command; the left panel has the offset distance. Pressed with nothing selected, the top of the panel asks you to select first.',
  'help.toolMirror.summary': 'Mirrors the selected entities about a line.',
  'help.toolConvert.summary': 'Brings the edges or the outline of a face of the model into the sketch as entities that follow the model.',
  'help.toolConvert.body': 'When sketching on a face, press this and click an edge or a face of the model: an edge is projected into an entity; a face becomes its outline and holes. These entities are purple, their place is the model\'s, and they move when the model changes; if the edge is gone the sketch reports "missing reference".\n\nYou do not have to press it: moving the cursor onto an edge of the model while drawing also works, see "Sketch Snaps and Inference".',
  'help.toolConvert.see': 'concept.sketch-snaps tool-pierce',
  'help.toolPierce.summary': 'Puts a point where an edge of the model that crosses the sketch plane goes through it.',

  // ---------------------------------------------------------------- edit and view
  'help.undo.summary': 'Undoes the last change.',
  'help.redo.summary': 'Does again what was undone.',
  'help.rebuild.summary': 'Rebuilds the whole part.',
  'help.fit.summary': 'Changes the view so that the whole model can be seen.',
  'help.viewFront.summary': 'Shows the front view.',
  'help.viewTop.summary': 'Shows the top view.',
  'help.viewRight.summary': 'Shows the right view.',
  'help.viewIso.summary': 'Shows the isometric view.',
  'help.viewNormal.summary': 'Normal To: turns to look straight at the sketch plane being edited.',
};
