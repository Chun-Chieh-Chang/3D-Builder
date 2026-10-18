import type { Translation } from '../index';

/** help: English of `zh-TW/help.ts` (docs/help-plan.md). The ids a topic points to (`see`) are not translated. */
export const help: Translation = {
  // ---------------------------------------------------------------- the window
  'helpui.title': 'Help',
  'helpui.button': 'Help',
  'helpui.buttonTip': 'Help (F1): opens the help on what you are doing',
  'helpui.whatIsThis': 'What Is This?',
  'helpui.whatIsThisTip': 'Then click any button or panel to open its help (Esc to cancel)',
  'helpui.search': 'Search help…',
  'helpui.contents': 'Contents',
  'helpui.noResult': 'Nothing found.',
  'helpui.related': 'Related topics',
  'helpui.close': 'Close',
  'helpui.back': 'Back',
  'helpui.pressF1': 'Press F1 for more',
  'helpui.noBody': 'This topic has no detailed text yet; its short description is above.',
  'helpui.shortcut': 'Shortcut: {key}',
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
    '- Click to select; in the tree a click only selects, a double-click edits.\n- Hold Ctrl and click to add to the selection or take from it.\n- With nothing being edited, edges and vertices can be clicked too (the "Selection Filter" at the top left, shown with F5, chooses one kind, as in SolidWorks; F6 makes every kind pickable again); select the edges first and then press Fillet, Chamfer, Edge Flange, Hem or a surface command that takes edges: the selected edges are taken in. Click on empty space to let go.\n- In a sketch, drag on empty space to box-select.\n- When a panel waits for a face or an edge, click it in the graphics area; what you pick is listed in the panel.',
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
    'When the cursor is near something, it lights up, its name appears next to the cursor, and clicking makes the matching relation:\n\n- Coincident: on an existing sketch point or the origin; the two become one point.\n- Midpoint, On entity: the middle of a line or of an arc (the middle of its sweep; when the arc changes the point stays in the middle), or anywhere on a line, circle or arc.\n- Horizontal to point, Vertical to point: when the cursor is level or plumb (within 5 pixels) with another sketch point (an end, a center, the origin), a gray dotted line joins them and a horizontal or vertical relation is added; lined up with two points, it snaps to where the lines cross.\n- Horizontal, Vertical: a line you draw is within 3° of horizontal or vertical from its start.\n- Collinear, Parallel, Perpendicular: a line you draw is within 3° of the direction of another line: starting on that line it is collinear (a gray dotted extension is drawn), otherwise parallel; a quarter turn away it is perpendicular; that line lights up.\n- Tangent: a line drawn from the end of an arc along its tangent; or, with the cursor near the point where a line from its start would touch a circle or arc, it snaps there and the tangent relation is added.\n- Perpendicular (foot): with the cursor near the foot of the perpendicular from the start of the line onto another line, it snaps there; the new line is perpendicular to that line and ends on it.\n- Intersection: with the cursor near where two entities cross, the new point becomes the intersection of both.\n- Quadrant point: the 0°, 90°, 180° and 270° places of a circle or arc; the new point is on the entity and level or plumb with its center.\n- On extension: past the end of a line, near where it would go on, the cursor snaps onto its extension (a gray dotted line from that end) and the new point is put on that line. Only when no other snap or inference applies.\n- Grid and angle (off by default): with the grid turned on in System Options light gray grid lines are drawn (every fifth a little darker) and a free point goes to where they cross; zoomed out so far that they would be closer than 8 pixels, the lines and the snap both step up to 2, 5, 10 … times the spacing, so a snapped point is always on a drawn line; with the angle turned on the direction of a line goes to a multiple of the angle step (within 3°); holding Shift while drawing a line makes its length a multiple of the grid spacing.\n- Model end point, Model midpoint, Model center, On model edge: when you sketch on a face, the edges of that face are snapped to; clicking makes that edge an entity that follows the model (purple) and the new point coincident with it, so the sketch moves when the model changes.\n- Edges of the model off the sketch plane are snapped to as well, projected onto it along its normal (straight edges, and circles and arcs parallel to the plane; not a line square to the plane nor a tilted circle); the edge is shown dashed. Clicking makes it a construction entity that follows the model (dashed, never part of a profile). Where several edges project onto the same place, the one nearest the plane is taken.\n- Pierce point: where a straight edge passes through the sketch plane. Clicking makes a point that follows the edge (as Pierce does).\n\nOrder of preference: the sketch\'s own points and midpoints first, then the model\'s ends, centers and midpoints (edges in the plane before projected edges and pierce points), intersections, quadrant points, tangent places and feet of perpendiculars, then places on sketch entities, then places on model edges, and only then horizontal, vertical, collinear and the like.\n\n"Sketch snaps" in System Options turns the whole thing off (nothing snaps and no relation is added by itself), or just some of the snaps. Hold Ctrl while sketching and the click lands where the cursor is, with no snap and no relation added; letting go of Ctrl brings them back (as in SolidWorks). While a drawing tool is active, right-click > Quick snaps keeps only one snap on and the others off until the tool changes or you end it.\n\nRelations added this way may make a relation you add by hand redundant; delete the automatic one from the relation list in the sketch panel.',
  'help.conceptSketchSnaps.keywords': 'snap inference dotted line horizontal to point vertical to point collinear parallel model edge magnet',
  'help.conceptSketchSnaps.see': 'sketch tool-line tool-convert',
  'help.conceptView.title': 'Viewing the Model: Mouse and Keyboard',
  'help.conceptView.summary': 'Turn, pan and zoom the view with the middle mouse button or the keyboard, as in SolidWorks; Ctrl+Shift+Z goes back a view.',
  'help.conceptView.body':
    'Mouse:\n\n- Drag with the middle button (the wheel) held: turn; Ctrl + middle drag: pan; Shift + middle drag: zoom; turn the wheel: zoom about the cursor.\n- On a touchpad, Alt + left drag turns.\n\nThe view cube (top right, as FreeCAD\'s navigation cube):\n\n- Its edges and corners are cut off, which leaves 26 faces: the 6 octagonal sides look from that side, the 12 edge faces at 45° from halfway between two sides, the 8 hexagonal corner faces along the cube\'s diagonal (isometric). The face under the cursor lights up.\n- The arrows around it (up, down, left, right) turn the model about its middle, and the two curved ones roll it in the plane of the screen (the right one clockwise), by the angle set in System Options (45° at first, apart from the arrow keys).\n- The ⌂ at the lower left returns to the isometric view; the ⇄ at the lower right turns to the back: the model is turned 180° to show exactly the opposite side, the top of the screen unchanged.\n\nKeyboard (as inSolidWorks; not while typing in a field, nor on a drawing):\n\n- Left, Right: turn about the screen\'s vertical axis through the model\'s middle, by the angle set in System Options (15° at first); Up, Down: about the horizontal axis. With Right, the side that faced you goes to the right.\n- Shift + arrow: a quarter turn (90°).\n- Alt + Left/Right: roll in the plane of the screen (Alt+Right is clockwise), by the same angle.\n- Ctrl + arrow: pan by a tenth of the view.\n- Shift+Z: zoom in; Z: zoom out (1.25 times each).\n- Ctrl+Shift+Z: back to the previous view (ten are kept; turning, panning and zooming with the mouse and the standard views count too).\n- Space bar: View Orientation; click a standard view to go to it.\n- Ctrl+1 to 7: front, back, left, right, top, bottom, isometric; Ctrl+8: normal to (in a sketch); F: zoom to fit.',
  'help.conceptView.keywords': 'rotate pan zoom arrow keys keyboard mouse middle button wheel view previous view space bar roll',
  'help.conceptView.see': 'fit view-front view-iso options',

  'help.conceptDrawingDimensions.title': 'Dimensions on a drawing',
  'help.conceptDrawingDimensions.summary': 'Linear, diameter, radius and angle dimensions on the views of a drawing; the numbers always come from the model.',
  'help.conceptDrawingDimensions.body':
    'Select a view in the drawing panel; the Dimensions section makes all of them at once (overall size, holes, where the holes are), or you choose:\n\n- Linear: the horizontal, vertical or aligned distance between two planes or circles (seen edge-on or as circles).\n- Diameter and radius: pick a circle or a hole; it can be written \"4×Ø9\"; with "Hole callout" ticked a hole carries what the model knows of it: through or depth, counterbore (C\'BORE Ø15 DEEP 8), countersink (CSK Ø12 90°, read from the cone at the mouth); a tapped hole is written by its thread with the drilled hole the model really has, like M6 THRU (TAP DRILL Ø5), and the thread is as deep as the drilling because the model has no thread.\n- Angle: pick two planes seen as lines (square to the view\'s x or y, or slanted); the arc is drawn where the two lines meet, its radius can be changed (Arc radius), and \"Use the other angle\" takes the supplement. The angle is the one between the two rays that run from where the lines meet toward the middle of each face, for example the top of a block and a 45° chamfer enclose 135° (45° with the supplement). Two parallel faces have no angle, and it says so.\n\n- Each dimension can have a tolerance (limits; for linear and diameter also an ISO 286 fit) and be made a reference dimension (in parentheses).\n- The number is worked out from the model every time, so it follows when the model changes; an element that is gone is reported with the reason.',
  'help.conceptDrawingDimensions.keywords': 'dimension angle diameter radius tolerance drawing',

  // ---------------------------------------------------------------- file
  'help.newPart.summary': 'Starts an empty part with the Front, Top and Right planes.',

  'help.newPart.body':
    'Starts an empty part.\n\n- When the present part has unsaved changes it asks first whether to save.\n- The feature tree of the new part holds only the "Origin" and the front, top and right planes, and the 3D window is empty.\n- The material and other settings of the new part come from the "template for New part" in System options (blank at first); to choose a template use "New part (template)…".\n- Next: select a plane, press "Sketch" to draw an outline, and grow a shape with "Extruded Boss/Base".',

  'help.newPart.keywords': 'new part empty planes template',

  'help.newPart.see': 'new-part-template sketch extrude',
  'help.newPartTemplate.summary': 'Starts a new part from a template, which sets the material and document settings (blank, carbon steel, aluminium, plastic, CNS drafting).',

  'help.newPartTemplate.body':
    'Starts a new part from a template: choose one and the material and document settings of the new part are set already.\n\n- Blank: no material.\n- Carbon steel, Aluminium (material aluminium alloy 6061), Plastic (material ABS), CNS drawing (carbon steel, drawing standard CNS, 2 decimals).\n- To have "New part" always use a template, choose it in System options under "Template used by New part".\n- There are no custom templates.',

  'help.newPartTemplate.keywords': 'template new part material aluminium plastic CNS',

  'help.newPartTemplate.see': 'new-part options properties',
  'help.newAssembly.summary': 'Starts an empty assembly; then insert components and add mates.',

  'help.newAssembly.body':
    'Starts an empty assembly (.3dba): several parts put together.\n\n- The first time you "Choose the project folder": an assembly finds its parts by relative paths, so the program has to be told which folder the parts are in; allow the browser to access it when it asks.\n- The "Start the assembly" panel appears, and the list "Parts to insert" holds the parts (.3dbx) and assemblies (.3dba, marked "3DBA") of the project folder. Click one, wait for it to load (the panel shows progress), and press ✔ to put it at the origin.\n- The first component is fixed at the origin automatically; add the others with "Insert component" and position them with mates.',

  'help.newAssembly.keywords': 'new assembly project folder components',

  'help.newAssembly.see': 'insert-component mate fix-component',
  'help.newDemo.summary': 'Opens a demo part to look at what features can make.',

  'help.newDemo.body':
    'Opens a demonstration part: a block of 20 × 10 × 5 mm with one rounded edge.\n\n- The feature tree has "Sketch1", "Extrude1" and "Fillet1", and the volume at the bottom is 991.416 mm³.\n- Use it to see what features look like, or for the steps of the verification manual, without drawing anything.\n- It is a new unsaved part and can be changed freely.',

  'help.newDemo.keywords': 'demo part example block fillet',

  'help.newDemo.see': 'new-part sketch fillet',
  'help.open.summary': 'Opens a part (.3dbx) or an assembly (.3dba) file.',

  'help.open.body':
    'Opens a part (.3dbx) or assembly (.3dba) file.\n\n- The browser\'s own "Open file" window appears; find the file and press "Open". Press "Allow" when the browser asks for access; when the present file has unsaved changes it asks first whether to save.\n- When opening an assembly, the first time you choose the "project folder" (the folder the .3dba is in), because an assembly finds its parts by relative paths.\n- While parts load, the bottom of the window shows progress.\n- After a crash, or when the tab was closed by accident, the program asks whether to recover the unsaved part.',

  'help.open.keywords': 'open file part assembly project folder',

  'help.open.see': 'save save-as new-assembly',
  'help.save.summary': 'Saves the file; asks where when it has no name yet.',

  'help.save.body':
    'Saves the present file; when it has no name yet it asks where to save.\n\n- A "*" after the tab title and the file name means there are unsaved changes.\n- After saving, the bottom of the window says "Saved …".\n- There is also autosave: some seconds after the last change (changeable in System options, 5 seconds at first) a temporary copy is kept; after a crash, or after closing the tab, "Found an unsaved part" appears and you can "Recover" or "Discard"; a recovered part has not been saved yet and needs "Save as".',

  'help.save.keywords': 'save autosave recover unsaved',

  'help.save.see': 'save-as open options',
  'help.saveAs.summary': 'Saves under a new name or place; saving an assembly elsewhere rewrites the relative paths of its parts.',

  'help.saveAs.body':
    'Saves under a new file name or in a new place.\n\n- When an assembly is saved in another folder, the relative paths of the parts are rewritten, and the undo history with them.\n- A drawing has to be saved inside the project folder; outside it, it says "A drawing must be saved inside the project folder …".\n- A part that has not been saved yet (a new part, a recovered part) uses this for its first save too.',

  'help.saveAs.keywords': 'save as rename folder relative paths',

  'help.saveAs.see': 'save open new-drawing',
  'help.exportStep.summary': 'Writes the part or assembly as a STEP file, which other CAD programs can open.',

  'help.exportStep.body':
    'Exports the part or assembly as a STEP file that other CAD programs can open.\n\n- Part: a window appears; choose the "format" (AP242, for example), tick "With colors", choose the "coordinate system" ("Part origin" at first, or one you made, whose origin and axes then become those of the file) and press "Export".\n- The browser downloads a .step file, and the bottom of the window says "Exported …".\n- Assembly: the hierarchy is the components, in their assembled positions (not the exploded ones), a sub-assembly is one level, and face colors go out too.\n- Surface bodies go out as shells; offset surfaces are converted to B-splines, and whether other CAD programs can read that has not been tried.\n- Open it in eDrawings or another CAD to see whether the shape and the colors are right.',

  'help.exportStep.keywords': 'export step file coordinate system colors AP242',

  'help.exportStep.see': 'import-step coord-sys export-stl',
  'help.exportStl.summary': 'Writes the solids of the part as an STL (triangle mesh) file; the fineness follows the document\'s mesh quality.',

  'help.exportStl.body':
    'Exports the solids of the part as an STL (triangle mesh) file, for 3D printing and slicing programs.\n\n- The fineness follows the document\'s "Display and export quality" (set in "File properties", fine or coarse): on the coarse setting a cylinder shows the edges of a polygon.\n- The browser downloads an .stl file.',

  'help.exportStl.keywords': 'export stl mesh printing fineness quality',

  'help.exportStl.see': 'export-step properties export-image',
  'help.exportImage.summary': 'Saves what the graphics area shows as a PNG image.',

  'help.exportImage.body':
    'Saves what the graphics area shows now as a PNG picture.\n\n- The view, the display type and the section are as they are now.\n- The browser downloads a .png file; open it in a picture viewer.',

  'help.exportImage.keywords': 'export image png picture screenshot',

  'help.exportImage.see': 'export-stl view-iso',
  'help.newDrawing.summary': 'Makes a drawing of a saved part or assembly (not while the file has unsaved changes).',

  'help.newDrawing.body':
    'Makes a drawing of a saved part or assembly (the command is grayed while the part has unsaved changes).\n\n- The first time you choose the "project folder" (the folder with the part files); the drawing has to be saved inside that folder too (.3dbd).\n- The window becomes the drawing: an A3 landscape sheet with the front, top and right views (first angle projection), and a title block at the bottom right (the drawing name is taken from the part).\n- The sheet section: size (A4, A3 …), orientation, scale (with "Best fit"), projection (first or third angle); the views always stay on the sheet.\n- Views: "Show hidden lines" can be ticked; drag a view to move it (it is remembered) and "Auto layout" returns to the automatic places.\n- The title block is filled in field by field: company, name, number, material, drawn by, date, revision, general tolerance, scale, projection.\n- Projected views, section views and detail views can be added, and dimensions put on (see "Dimensions on a drawing").\n- A sheet metal part can have a "Flat pattern" view (choose "Flat pattern" in the direction list of the views or of the new view): it draws the outline and holes of the flat pattern, with the bend lines as chain lines; for a part that is not sheet metal the view says why. No projected or section view can be made from a flat pattern (the folded part is not seen in it), a detail can; dimensions are not possible in it yet.\n- The drawing reads the part files from the project folder: change the part, save, reopen the drawing and it follows; when an element a dimension refers to is gone, the dimension says "the element the dimension refers to was not found".',

  'help.newDrawing.keywords': 'drawing sheet views title block three views first angle third angle',

  'help.newDrawing.see': 'concept.drawing-dimensions save-as export-step',
  'help.generateAssembly.summary': 'Writes a derived part file for each body of the part, then an assembly made of them (save the part first).',

  'help.generateAssembly.body':
    'Writes a derived part file for each body of the part, and then makes the assembly built from them; it takes a multi-body part (a jig master model, for example) apart into parts, placed already.\n\n- The part has to be saved first.\n- A derived part keeps only its source (the master model) and the body number, and the names of faces carry over from the master model; when the master model changes, generate again and it follows (it does not update live).\n- The parts list leaves out reference parts; one body of the master model is one component of the assembly.\n- Limits: no live update, and parts do not share the master model\'s rebuild.',

  'help.generateAssembly.keywords': 'generate assembly derived part body master model jig',

  'help.generateAssembly.see': 'new-assembly insert-component bom',
  'help.importStepAssembly.summary': 'Reads a STEP assembly and splits it into part files and an assembly.',

  'help.importStepAssembly.body':
    'Reads a STEP assembly and keeps its structure: a .3dbx for every part and a .3dba for every sub-assembly.\n\n- After you pick the STEP file the program says how many parts and sub-assemblies there are and asks for a folder to put the converted files in (each time; it needs write access); allow it when the browser asks.\n- The folder gets the part files, and an "assemblies" folder when there are sub-assemblies; positions and face colors are kept.\n- Component names are "file name + number", not the names in the STEP file.\n- A file that AP203 has merged into a single solid reads as one part.',

  'help.importStepAssembly.keywords': 'import step assembly structure parts sub-assemblies colors',

  'help.importStepAssembly.see': 'import-step export-step new-assembly',
  'help.returnAssembly.summary': 'Goes back from the part being edited to the assembly that opened it.',

  'help.returnAssembly.body':
    'Goes back from the part being edited to the assembly it was opened from.\n\n- It works only when you opened a part from an assembly to change it.\n- When the part has been changed and saved, the component is updated on returning to the assembly.\n- Save the changes to the part first, so that the assembly can read them.',

  'help.returnAssembly.keywords': 'return to assembly open part edit part',

  'help.returnAssembly.see': 'open insert-component new-assembly',

  // ---------------------------------------------------------------- tools
  'help.equations.summary': 'Defines global variables and expressions that dimensions and feature values can use.',

  'help.equations.body':
    'Defines global variables and expressions that dimensions and feature values can use. Leave the sketch first (it is grayed while a sketch is edited).\n\n- "Global variables": type a name and an expression in the bottom row (w and 30, for example) and press "Add"; dimensions can then say w*2. Change the expression of a variable and every dimension that uses it follows at once.\n- The "Sketch dimensions" table lists the dimensions of each sketch, and a number can be changed into an expression right there.\n- A wrong expression (w*, for example) is marked invalid, the bottom of the window says the expression is incomplete, and the model keeps its last size.\n- A circular reference (b uses a, a uses b) is refused and the route around the circle is given (circular reference: b → a → b).\n- When a variable is renamed, the expressions that use it are changed to the new name.\n- The number boxes of feature panels can hold expressions too (a depth of h/2, with "= 7.5 mm" beside the box); file properties can be used as well: property(\'thickness\').\n- A dimension in a sketch that comes from an expression is shown like Σ60.',

  'help.equations.keywords': 'equations global variables expressions parameters dimension reference',

  'help.equations.see': 'properties sketch concept.property-manager',
  'help.appearance.summary': 'Sets the color of the part, a body, a feature or a face; a face beats a feature, then a body, then the part.',

  'help.appearance.body':
    'Gives a color to the part, a body, a feature or a face. First click a face in the view (or select something in the tree), then press this command.\n\n- "Color applies to": the whole part, a body, a feature or a face; pick the color with the swatch beside "Color" and press "Apply"; the "Colored" list shows what has been set and "Remove color" takes one away.\n- Priority: face > feature > body > part; the faces made by patterns and mirrors carry the color of the same feature.\n- Tick "With colors" when exporting STEP and they go out with it.',

  'help.appearance.keywords': 'appearance color paint face feature body',

  'help.appearance.see': 'export-step properties',
  'help.options.summary': 'System options: interface language, autosave, the template of New Part, what can be picked at the start, the filter bar; kept in this browser, not in the part file.',

  'help.options.body':
    'System options: the interface language, autosave, the template for new parts, the elements that can be picked at the start, the filter bar, and sketch snaps. They are kept in this browser, not in the part file.\n\n- Interface language: Traditional Chinese or English; it takes effect at once (some of the assembly screens and the content of the demo part are still in Chinese).\n- Autosave: on or off, and "seconds after the last change" (5 at first).\n- "Template used by New part": blank, carbon steel, aluminium, plastic, CNS drawing.\n- Elements that can be picked at the start: "All" or one kind (faces, edges, vertices, planes); with one kind chosen, the "Selection filter" starts with only that kind pickable.\n- Selection filter bar: whether it shows at the start (F5 toggles it in the graphics area at any time, like the SolidWorks toolbar).\n- Sketch snaps: the master switch and each kind (end points, midpoints, nearest point on a curve, quadrants, intersections, tangent, perpendicular foot, horizontal and vertical points, the extension of a line, edges and vertices of the model, grid, angle), the grid spacing and the angle step; grid and angle are off at first. See "Sketch snaps and inference".',

  'help.options.keywords': 'system options language autosave template selection sketch snap settings',

  'help.options.see': 'concept.sketch-snaps new-part-template save',
  'help.shortcuts.summary': 'Shows and changes the shortcut key of each command.',

  'help.shortcuts.body':
    'Shows and customizes the keyboard shortcut of every command.\n\n- Click the cell to the right of a command, press the key combination you want (Ctrl+Shift+E, for example) and press "Close"; from then on that combination runs the command.\n- "Restore defaults" changes everything back.\n- Undo is Ctrl+Z, redo is Ctrl+Y; F1 opens the help.',

  'help.shortcuts.keywords': 'shortcuts keyboard keys hotkey customize',

  'help.shortcuts.see': 'undo redo concept.overview',
  'help.measurePart.summary': 'Measures distances and angles between the points, edges and faces you pick; press again to end.',

  'help.measurePart.body':
    'Measures distances and angles between the points, edges and faces picked on the part; press it again or "Done" to finish.\n\n- Click elements in the 3D window; picking another starts over, and picking an element again takes it off.\n- One element: a face gives its area, an edge its length, a circle its radius and diameter, a vertex its coordinates. Two elements: the shortest distance (0 when they touch), with ΔX, ΔY, ΔZ for two vertices; the angle is the acute one (0 to 90 degrees).\n- The units are mm and degrees.',

  'help.measurePart.keywords': 'measure part distance angle area radius coordinates',

  'help.measurePart.see': 'measure-assembly physical-part check-part',
  'help.draftAnalysis.summary': 'Analyses the draft angle of each face against the pull direction and colors the faces.',

  'help.draftAnalysis.body':
    'Analyzes the draft angle of each face against the pull direction and colors the graphics area, to see whether a plastic part has enough draft.\n\n- The window\'s settings: "Pull direction (the way the mold opens)" (+Z at first, so make the shell on the front plane with the opening toward you), "Required draft angle (degrees)", "Reverse direction", "Use the normal of the selected plane" (click a plane in the view first).\n- The angle is defined as the angle between the face normal and the direction, less 90°; a positive value means the part can be released along that direction.\n- The result table classifies: positive draft, negative draft, needs draft (less than required), straddling, cannot be sampled, each with the number of faces and the area; the "Faces" list gives the smallest to the largest angle.\n- "Reverse direction" swaps the classes. "Close" removes the colors. It colors the same faces as "Undercut analysis", so only one is open at a time.\n\nVerified example: a straight-walled shell of 60 × 40 × 30, wall 2, open at the top, direction +Z: positive draft 2 faces (2400 mm²), negative draft 1 face (2400), needs draft 8 faces (11152 mm²), straddling 0.',

  'help.draftAnalysis.keywords': 'draft analysis mold release angle plastic direction',

  'help.draftAnalysis.see': 'undercut-analysis draft thickness-analysis',
  'help.undercutAnalysis.summary': 'Finds the faces that are blocked at both ends along the pull direction (undercuts).',

  'help.undercutAnalysis.body':
    'Finds the faces that are hidden at both ends along the pull direction (undercuts), which the mold cannot release and which need a side core.\n\n- The window\'s settings: the direction (along the opening at first); the result table lists the number and area of undercut faces; the "Faces" list gives for each face the share seen from above, from below or from neither.\n- The classes: undercut (needs a side core), seen only from above, seen only from below, seen from both (walls along the direction, which need draft).\n- Turn the direction to the direction of a hole and the wall of the hole is no longer an undercut. A part with no undercut shows an undercut area of 0.\n- The window gives the number of triangles, the number of sample points and the milliseconds used.\n- It colors the same faces as "Draft analysis", so only one is open at a time; the direction carries over when the other is opened.\n\nVerified example: the shell (60 × 40 × 30, wall 2) with a hole through it sideways: the wall of the hole, 753.98 mm², is the only undercut; the shell without the hole has 0 undercut faces, 6 faces seen only from above (7552 mm²), 1 only from below and 4 from both.',

  'help.undercutAnalysis.keywords': 'undercut analysis side core mold direction hole',

  'help.undercutAnalysis.see': 'draft-analysis thickness-analysis shell',
  'help.thicknessAnalysis.summary': 'Measures the wall thickness of each face along its inward normal and shows the thinnest and thickest places.',

  'help.thicknessAnalysis.body':
    'Measures the wall thickness of each face along the inward normal and marks places that are too thin or too thick.\n\n- The window\'s settings: "Minimum wall thickness (mm, blank = no limit)" and "Maximum wall thickness"; it recalculates when they are filled in; both have to be numbers above 0 with the minimum not above the maximum, otherwise they are marked invalid and it says why.\n- The result table classifies: within limits (green), too thin (red), too thick (blue), no face opposite to measure, cannot be sampled; it also lists "the thinnest place", "the thickest place" and "Faces (least / median / greatest mm)".\n- The thickness is the distance along the inward normal to the face opposite; for the faces of the rim at the opening it is the height of the whole wall, so they count as too thick (it is their distance, not a wall thickness).\n- SolidWorks may define thickness differently; note the difference when comparing with it.\n\nVerified example: the shell of 60 × 40 × 30 with walls of 2, minimum 1 and maximum 4: 10 faces are within limits, the rim faces at the opening are too thick, and the thinnest place is 2 mm; with the minimum changed to 3, the ten faces become too thin.',

  'help.thicknessAnalysis.keywords': 'thickness analysis wall thin thick plastic measure',

  'help.thicknessAnalysis.see': 'draft-analysis undercut-analysis shell',
  'help.checkPart.summary': 'Checks the geometry: whether it passes the validity check, whether the shell is closed (no open edges) and whether the volume is positive.',

  'help.checkPart.body':
    'Checks the model geometry of the part: the solids, the faces, the faulty faces, the open edges and the volume.\n\n- "Has a problem" means: the OCCT validity check did not pass, the shell is not closed (an open edge that belongs to one face only), or the volume is zero or negative.\n- Imported STEP files and repaired models need it most; the numbers of the faulty faces are listed.\n- A sound part shows "1 part in all, all fine".',

  'help.checkPart.keywords': 'check geometry validity open edges shell volume',

  'help.checkPart.see': 'check-assembly import-step physical-part',
  'help.physicalPart.summary': 'Sets the material and works out mass, center of mass and moments of inertia.',

  'help.physicalPart.body':
    'Sets the material and works out the mass, volume, surface area, center of mass and moments of inertia of the part.\n\n- First choose the material in Tools → File properties (carbon steel, cast iron, stainless 304, aluminium 6061 and 7075, copper, brass, titanium, ABS, PC, nylon PA6, POM, PP, acrylic) or choose "Custom…" and type the density (g/cm³). Mass = volume × density, reference bodies left out.\n- The window lists the mass, volume, surface area, center of mass, moments of inertia (about the center of mass, along the axes) and the principal moments (smallest first) with their directions.\n- Units: mass g, volume mm³, surface area mm², center mm, moments g·mm².\n- The densities of the built-in materials are round values for common grades; use "Custom" for other grades.\n\nWorked by hand: a block of 40 × 30 × 10 has a volume of 12000 mm³ and, in carbon steel (7.85 g/cm³), a mass of 94.20 g.',

  'help.physicalPart.keywords': 'physical properties mass material density center of mass inertia',

  'help.physicalPart.see': 'properties physical-assembly check-part',
  'help.properties.summary': 'Edits the file properties (part number, supplier, description…), which the bill of materials reads.',

  'help.properties.body':
    'Edits the file properties: material, display and export quality, custom properties (part number, vendor, description …). The command is grayed while a sketch is edited; leave the sketch first.\n\n- Material: choose from the list (carbon steel, cast iron, stainless 304, aluminium 6061 and 7075, copper, brass, titanium, ABS, PC, nylon PA6, POM, PP, acrylic) or "Custom…" and type the density (g/cm³); after that the window shows "Mass: … g" and the status bar gains a mass (mass = volume × density).\n- Display and export quality: fine or coarse, which sets how fine the mesh is (display and STL).\n- Custom properties: in the bottom row type a name and a value (Thickness and 4mm, for example) and press "Add". Dimensions and feature values can refer to it as property(\'Thickness\'); the parts list reads "Vendor" and "PartNo".\n\nWorked by hand: a block of 8000 mm³ in carbon steel (7.85 g/cm³) has a mass of 62.80 g.',

  'help.properties.keywords': 'file properties material density quality custom part number vendor',

  'help.properties.see': 'equations physical-part bom',

  // ---------------------------------------------------------------- features
  'help.sketch.summary': 'Makes a sketch on the selected plane, coordinate system or face and enters it.',
  'help.sketch.body':
    'Click a plane in the tree (or a flat face in the graphics area), then press Sketch. In the sketch:\n\n- The left panel shows the sketch state: fully defined, under defined (N degrees of freedom left) or over defined. Blue entities are under defined, black ones fully defined, red ones in conflict.\n- Draw with the tools of the Sketch tab, dimension with Smart Dimension, and add relations to the selected entities in the panel.\n- While a sketch is edited, Equations and File Properties are gray; after leaving it, change a dimension in the "Sketch dimensions" table of the Equations window.\n- To make a feature from the sketch its outline has to be closed; "Check sketch for feature" in the panel lists open end points, and a larger gap tolerance repairs them in one click.',
  'help.sketch.keywords': 'sketch enter fully defined under defined over defined open end point gap tolerance',
  'help.sketch.see': 'exit-sketch tool-dimension concept.sketch-snaps extrude',

  'help.offsetSketch.summary': 'Sketches on a plane offset from the selected one: confirm the reference plane and the sketch opens.',
  'help.offsetSketch.body':
    'Pick a datum plane or coordinate system in the tree, or a planar face in the graphics area, and press "Offset Sketch" on the Sketch tab: set the distance and confirm, and the offset plane is made and its sketch opens on it. With nothing picked the front plane is the one offset from.\n\n- The distance starts at the value confirmed last time (10 mm the first time).\n- The command makes a real reference-plane feature that sits before the sketch in the tree: change its distance later and the sketch, and the features built on it, move with it.\n- When the plane lies beyond the rollback bar and the last rebuild never found it, the command waits for the rebuild that does; if none comes it says why and puts nothing in the tree.\n- Cancelling makes neither the plane nor the sketch.',
  'help.offsetSketch.keywords': 'offset datum plane distance sketch plane',
  'help.offsetSketch.see': 'sketch ref-plane exit-sketch',

  'help.angleSketch.summary': 'Sketches on a plane at an angle to the selected one: pick an edge or axis to turn about, then confirm.',
  'help.angleSketch.body':
    'Pick a datum plane or coordinate system in the tree, or a planar face in the graphics area, and press "Angle Sketch" on the Sketch tab: a plane turned to an angle (45° by default) is made and its sketch opens.\n\n- "Rotation axis" has to be filled: click a straight edge or a datum axis in the graphics area, or use the axis buttons of the panel; confirming without it says what is missing.\n- The angle is measured from the plane that was picked: 0° is parallel to it, 90° perpendicular.\n- As with "Offset Sketch" the reference-plane feature stays in the tree, so the angle and its references can be changed later.\n- A sketch on a slanted face no longer needs the plane made first and then found in the tree.',
  'help.angleSketch.keywords': 'angle tilted datum plane rotation axis sketch plane',
  'help.angleSketch.see': 'sketch offset-sketch ref-axis ref-plane',

  'help.sketchPicture.summary': 'Lay a PNG or JPEG image in the plane of a sketch to trace over.',

  'help.sketchPicture.body':
    'While a sketch is edited, press "Sketch Picture…" and pick an image (for example a standard view saved from eDrawings): it is laid in the plane of the sketch as a background to trace.\n\n- A picture is only a background: it takes no part in the profiles, relations or dimensions of the sketch, it is not a feature of the part, and it is shown only while this sketch is edited.\n- The panel changes its centre, size, turn and opacity; changing the width keeps the proportions.\n- "Scale from two points": click two points on the picture and type the real distance between them (for example a length measured in eDrawings): the picture grows or shrinks about the first point to the right size.\n- The image is kept in the part file as it was (PNG or JPEG), and goes when the picture is deleted unless another picture uses it.\n- How exact the tracing is depends on the resolution of the image and where you click; put the measured numbers on the sketch as dimensions.',

  'help.sketchPicture.keywords': 'sketch picture trace background image scale eDrawings',

  'help.sketchPicture.see': 'sketch tool-line tool-dimension',

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
  'help.thread.summary': 'Sweeps a tooth profile sketch along a helix around an axis, cutting or adding to the part.',

  'help.thread.body':
    'Draw a closed tooth profile sketch on a plane through the axis, select the sketch and invoke this command.\n\n- Thread Axis: Pick a cylindrical face, conical face, datum axis, or sketch line as the helical axis.\n- Operation: Cut (remove thread grooves) or Boss (add thread crests).\n- Pitch: Axial distance between adjacent crests; supports expressions.\n- Starts: Single-start (1), double-start (2), or multi-start threads.\n- Hand: Right-hand (RH) or Left-hand (LH).\n- Length: Axial length of the thread sweep (empty for automatic profile-derived length).\n- Taper: Half-angle for conical threads (default 0° for cylindrical).\n- Start Phase: Angular phase offset in degrees.\n- Reverse: Flips the axial progression direction.\n\nBoth ends are flat cut; the thread starts at the axial plane of the profile sketch.',

  'help.thread.keywords': 'thread pitch lead starts helix helical internal external tap',

  'help.thread.see': 'revolve revolve-cut sweep extrude-cut',

  'help.knurl.summary': 'Rolls a straight, helical or diamond knurl into a cylindrical face.',

  'help.knurl.body':
    'Pick an axis (a cylindrical face, a straight edge or a reference axis) and the blank diameter, type how many grooves go round and how deep they cut, and press ✔.\n\n- Pattern: straight grooves run along the axis, helical ones wind one way, diamond is both hands crossing (the usual knurl).\n- Blank diameter: the knurled outside diameter the drawing gives. The ridges reach it and the V grooves cut in from it, so the body has to be that size on that axis already; when the grooves cut nothing away the feature fails and says so.\n- Grooves: how many go round the circumference. It has to be a whole number, so that the pattern comes round exactly and has no seam. Circular pitch = π × diameter ÷ grooves.\n- Depth and V included angle: the spacing between neighbouring grooves limits how deep they can be (about four tenths of it at a 90° included angle); too deep is refused, with the limit in the message.\n- Helix angle: the angle of a groove to the axis for a helical or diamond knurl, usually 30°. The shallower it is, the closer the grooves come along the axis and the less deep they can be.\n- Start angle: where the whole pattern begins round the axis.\n- Reverse: measures the knurl length from the other end of the axis.\n\nA knurl is always a cut: real knurling displaces material, and this builds what a drawing means by a knurled diameter — V grooves taken out of that diameter — so STEP and 3D printing both work with it.\n\nA diamond is cut once per hand, which takes out exactly the same material as cutting the union would (body \\ (A ∪ B) = (body \\ A) \\ B). It is done in two steps because one tool holding both hands has its two sets of solids crossing one another, and OCCT does not resolve that: it leaves the faces inside the crossing in the result. That also makes a diamond slower — the second hand has to intersect every groove the first one left. The more grooves, the slower (roughly as the square of the count): a coarse diamond is quick, a fine one is noticeably slower.',

  'help.knurl.keywords': 'knurl diamond straight helical groove pitch blank roll',

  'help.knurl.see': 'thread revolve extrude-cut circular-pattern',
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

  'help.jog.summary': 'Jogs the sheet along a sketch line: one side stays put while the other steps up or down, with two opposite bends and a flat web between them.',

  'help.jog.body':
    'Draw a sketch line on a face of the sheet as the jog line and press ✔; one side of the line stays fixed and the other is stepped up or down along the normal.\n\n- The "jog height" is the vertical offset between the two parallel plates; the "jog angle" is 90° at first, from 30° to 90°.\n- The height has a floor of (2 × inside bend radius + thickness) × (1 − cos angle): below it the two bends would cut through each other, and the feature fails and says so.\n- The inside bend radius and the K factor fall back to the sheet parameters when left unset.\n- Unlike a mid bend (one bend, the end plate turns by an angle), a jog bends twice: the end plate stays parallel but sits a step lower (or higher).',

  'help.jog.keywords': 'jog z bend sheet metal step height angle',

  'help.jog.see': 'edge-flange base-flange concept.selection',
  'help.edgeFlange.summary': 'Folds a flange up from an edge of a sheet metal plate, with length, angle and bend radius.',

  'help.edgeFlange.body':
    'Grows a bend and a flat flange on a straight edge of a sheet metal plate, as wide as the whole edge.\n\n- Click an edge of the plate in the view (clicking a face does nothing). The flange folds to the side of the face the edge you clicked belongs to; "Flip to the other side" changes it.\n- Flange length, measured from the outside virtual sharp at first (the outside size on a drawing); it can also be measured from the inside virtual sharp or after the bend.\n- Bend angle (blank = 90°) and bend radius (blank = that of the base).\n- Position: "Material inside" (the outside is flush with the edge and the plate is cut away near the edge) or "Bend outside" (the bend starts at the edge, the plate does not move).\n- The start and the end can be shortened, with a rectangular relief cut at the shortened end, so that flanges on neighboring edges do not touch at the corner.\n- Mitre: this flange and the one made before it next to the corner meet on a vertical plane at 45°; "Mitre at the start / end" takes the gap between the two flanges (0 = touching). Only for two 90° flanges with the same radius, material inside, bent the same way, on edges at right angles; the neighbour has to be made first and has to reach the corner. In the flat pattern the end at the corner follows the bend as a curve.\n\nVerified example: a plate 100 × 50 × 1.5 (7500 mm³), bend radius 2, 90°, length 30 from the outside, material inside: the plate loses 262.5, the bend is 323.98 and the flat is 1987.5, in all 9548.98 mm³.',

  'help.edgeFlange.keywords': 'sheet metal edge flange bend length angle relief inset',

  'help.edgeFlange.see': 'base-flange hem flat-pattern concept.property-manager',

  'help.breakCorner.summary': 'Chamfer or fillet external corners at sheet metal flange free ends, including the flat pattern.',
  'help.breakCorner.body': 'Select the external corner edge at an edge-flange free end, then set chamfer or fillet and its size. Supports open, non-mitred corners only. The cut is mapped to the flat pattern through the existing sheet-metal unfold flow.',
  'help.breakCorner.keywords': 'sheet metal break corner flange chamfer fillet flat pattern',
  'help.breakCorner.see': 'edge-flange hem flat-pattern',

  'help.midBend.summary': 'Bend a plate in the middle along a sketched line: one side stays, the other folds.',

  'help.midBend.body':
    'On a plate made by a base flange (closed profile), pick a sketch with one straight line, press "Mid Bend", and set the angle and the radius.\n\n- The left of the way the line is drawn stays, the right folds; "Keep the right of the line fixed" swaps the sides, "Fold against the sketch normal" the way it folds.\n- The zone of the bend is centred on the line and as wide as the bend allowance, so the flat pattern is the plate as drawn (the flat view has one more bend line).\n- There can be no hole or notch in the zone: the plate there has to be a plain strip; it says why when it is not.\n- No edge flange or hem before it, one mid bend to a part, and none after it either.\n- The sketch has to be parallel to the plate; when the side that folds runs into the other it says so.',

  'help.midBend.keywords': 'sheet metal mid bend sketched bend bend line plate',

  'help.midBend.see': 'base-flange edge-flange flat-pattern',
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
    'Makes a cantilever beam at every free point of the sketch, growing from the face the sketch is on along its normal; the end of the beam has a wedge-shaped hook sticking out along the angle: flat underneath (the face that catches), sloped on top (the lead-in).\n\n- Width, beam thickness (along the angle), beam length, hook height, hook depth (how far it sticks out).\n- The beam sinks a little into the body, so it always joins.\n- The sizes are typed by hand; the program does not work out the strain of the beam or choose the material and the angle for you.\n- Tick "Window under the hook" to cut a window under the hook as well, in front of the beam (for the core to pass from below, so that the catch face of the hook is no longer an undercut): from the front of the beam to the tip of the hook and the "clearance" beyond it, the clearance beyond each side too, the depth counted into the body from the sketch plane, more than the thickness of the floor to go through.\n- Cut the other half with "Snap catch" (a window).',

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

  'help.offsetSurface.body':
    'Click the faces to offset (all the faces of a region offsets that region), type the "offset distance" and press ✔: a new surface body is made and the original body stays.\n\n- A positive value goes to the outside of the face, a negative one to the inside.\n- Corner join: arc (every point is the same distance from its source) or sharp (a meeting of the faces).\n- The result is measured after the offset; when it differs from the distance asked by more than the tolerance (0.05 mm) the feature fails and says by how much.\n- A surface body is not a part: it has no mass, is not in the parts list, takes no part in interference or drawings, and goes into STEP as a shell.\n- While editing, the result of the offset is shown.',

  'help.offsetSurface.keywords': 'offset surface surface body distance',

  'help.offsetSurface.see': 'thicken knit split-line',
  'help.splitLine.summary': 'Projects the closed outer loop of a sketch onto a face and splits the face into regions.',

  'help.splitLine.body':
    'First sketch a closed outline, then press this command: choose the "sketch to project" and the "face to split"; the outline is projected along the sketch normal onto the face and the face is cut into regions.\n\n- The faces of the regions have names of their own (`<feature>:side:<sketch>.<loop>`) which do not change when the sketch does, and can be picked for an offset surface.\n- When the direction is wrong tick "Reverse projection direction"; "Through all" splits every layer of faces the view passes through.\n- The edges of the outline must not lie along the seam of a cylinder or cone, otherwise it fails.\n- A projection that does not reach the face, a face that is gone, and a sketch that is not closed are each explained.',

  'help.splitLine.keywords': 'split line project region face sketch',

  'help.splitLine.see': 'offset-surface trim-surface sketch',
  'help.knit.summary': 'Sews surfaces together into one surface body or a solid.',

  'help.knit.body':
    'Sews several surface bodies into one: tick the bodies in the list, or click faces of bodies in the view.\n\n- Knit tolerance: edges closer than this are sewn together; blank means 0.01 mm.\n- When the sewn result is closed, tick "Make a solid when closed" to get a solid; free edges left after sewing mean it is not closed, and the result is still a surface.\n- The result is the first body picked, the others are used up; the names of the faces stay.\n- When there is no surface body to pick, first make an offset, fill or flat surface.',

  'help.knit.keywords': 'knit sew surface body solid tolerance',

  'help.knit.see': 'offset-surface thicken fill-surface',
  'help.fillSurface.summary': 'Patches a surface across a loop of edges.',

  'help.fillSurface.body':
    'Click the edges that enclose a boundary and a surface is made across it, a new surface body.\n\n- Continuity with the neighboring faces: tangent or contact only. Tangent applies only where an edge has a single neighboring face (a hole in a surface, for example).\n- How far the fill lies from the edges at most, and how many degrees the tangents differ, are shown under the panel; beyond the tolerance it fails.\n- Often used to close a hole in a surface, then knit into a solid.',

  'help.fillSurface.keywords': 'fill surface patch hole tangent continuity',

  'help.fillSurface.see': 'knit flat-surface offset-surface',
  'help.flatSurface.summary': 'Patches a flat surface across a closed loop of edges.',

  'help.flatSurface.body':
    'Select a closed loop of edges lying in one plane and a planar face is made across it, a new surface body.\n\n- The edges have to form a loop and all lie in one plane; otherwise the feature fails and says why.\n- The result can be knitted with other surfaces into a solid.',

  'help.flatSurface.keywords': 'flat surface planar cap close',

  'help.flatSurface.see': 'fill-surface knit',
  'help.trimSurface.summary': 'Cuts regions in a surface with a sketch and keeps one side.',

  'help.trimSurface.body':
    'The closed outline of a sketch is projected along the sketch normal onto the faces of a surface body, which cuts them apart; the inside (or the outside) of the outline is kept and the rest dropped.\n\n- Choose the sketch and the surface body, and for "Keep" the inside or the outside of the outline.\n- When the direction is wrong choose "Reverse".\n- The edges of the outline must not lie along the seam of a cylinder or cone.\n- Only the outer loop of the outline is used; holes inside the sketch are not handled.',

  'help.trimSurface.keywords': 'trim surface keep inside outside outline project',

  'help.trimSurface.see': 'split-line extend-surface knit',

  'help.mutualTrim.summary': 'Cut two surfaces where they cross, then pick which pieces stay.',

  'help.mutualTrim.body':
    'Select two surface bodies: they are cut where they cross, and each body becomes its pieces.\n\n- A piece is named after the face it came from; when one face falls into several they get #1, #2… (in the order of their position).\n- Pick a piece in the graphics area to take it away, pick again to take it back; or take it back from the list "Pieces taken away" in the panel.\n- At least one piece of each body has to stay.\n- When the surfaces have no curve in common (they do not meet or only touch), or lie on each other in part, it says so.\n- The two bodies can go on into "Knit" and "Thicken".\n- The order of the pieces of one face is by position: when a dimension changes and the number of pieces with it, a piece picked before may not be found, and it says so.',

  'help.mutualTrim.keywords': 'mutual trim trim surface crossing cut keep pieces',

  'help.mutualTrim.see': 'trim-surface knit thicken',
  'help.extendSurface.summary': 'Extends the edges of a surface body by a distance.',

  'help.extendSurface.body':
    'Select an edge of a surface body and type the "extend distance": the face grows on in its own direction.\n\n- Only a surface body of a single face can be extended.\n- The edge you pick decides which side extends; an edge that goes all the way round (with no ends) cannot be extended.\n- Use it before "Cut with surface" to make the surface go right through the solid.',

  'help.extendSurface.keywords': 'extend surface distance edge',

  'help.extendSurface.see': 'cut-with-surface trim-surface offset-surface',
  'help.thicken.summary': 'Gives a surface body a thickness and makes it a solid.',

  'help.thicken.body':
    'Select a surface body, type the "thickness" and press ✔: the surface is thickened into a solid.\n\n- A positive value goes to the side of the surface normal, a negative one to the other side.\n- Tick "Both sides": the thickness is the total, half each side of the surface (a negative value is the same as a positive one).\n- Tick "Keep the surface": the surface body is left as it is, and the result is another, new solid body; the faces of the solid have "copy" in their names, so that no two bodies have a face of the same name.\n- The result replaces the surface body and becomes a solid (the surface is used up) when the surface is not kept.\n- It measures afterward whether the farthest point is this far from the surface, and fails when it is far off.',

  'help.thicken.keywords': 'thicken surface solid thickness',

  'help.thicken.see': 'knit offset-surface cut-with-surface',
  'help.cutWithSurface.summary': 'Uses a surface as a knife to cut one side away from a solid.',

  'help.cutWithSurface.body':
    'Divides a solid with a surface body: choose the solid and surface body, then set a plane normal or fixed XYZ vector as the direction.\n\n- Choose whether to keep the side behind or ahead of the direction; the surface body stays as it is.\n- The surface has to go right through the solid; when it is too small use "Extend surface" first.\n- "Reverse direction" reverses the direction vector.\n- Vector components must be finite and the vector cannot be zero. Clicking faces of either body also picks them.',

  'help.cutWithSurface.keywords': 'cut with surface split solid remove side',

  'help.cutWithSurface.see': 'extend-surface thicken extrude-cut',
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

  'help.importStep.body':
    'Reads a STEP file in as a body of the part, repairing it when necessary.\n\n- Press it in a new part, choose the .step file in the browser\'s window, wait a few seconds; the model appears in the 3D window and the tree gains a row "Import1".\n- Double-click "Import1" (a single click only selects) to open its panel: "Imported data" (the file name; the data is kept in the part file, so the original is not needed) and "Diagnostic report" (how many solids and faces the file holds, the result of the validity check, what was changed).\n- The "sewing tolerance" (0.01 at first) matters only when the file holds surfaces and no solid.\n- You can then add features to it: sketch on its faces, extrude, delete faces, move faces and so on.\n- When the diagnostic report has warnings, look again with "Check geometry".\n\nVerified example: a plate of 40 × 30 × 10 with a hole of radius 4 in the middle: volume 40 × 30 × 10 − π × 4² × 10 ≈ 11497 mm³.',

  'help.importStep.keywords': 'import step body diagnostic report repair sewing',

  'help.importStep.see': 'delete-face move-face check-part export-step',

  'help.cosmeticThread.summary': 'Draws a cosmetic thread on the selected cylinder or hole wall: display only, no real thread geometry.',

  'help.cosmeticThread.body':
    'Pick a cylindrical face (an external thread) or the wall of a hole (an internal thread) in the graphics area, choose a standard designation (M8, 1/4-20 UNC, …) or custom major, minor and pitch values, pick the end condition (through, or a given depth) and press ✔.\n\n- The 3D window draws a 3/4 thin arc at the end face, and two thin lines (external) or two dashed lines (internal) in the side view; drawings follow ISO 6410-1.\n- The geometry of the part does not change: no thread kernel and no booleans, so volume and mass are unaffected.\n- Only cylindrical faces are accepted; a plane, a cone or a free surface makes the feature fail and say why.\n- The depth (the given length) must be greater than 0.',

  'help.cosmeticThread.keywords': 'cosmetic thread representation ISO 6410 external internal cylinder',

  'help.cosmeticThread.see': 'thread hole export-step',

  'help.split.summary': 'Cuts bodies in two with a datum plane or a planar face of a solid.',

  'help.split.body':
    'Pick a datum plane or a flat face of a solid as the cutting plane and press ✔; every body it crosses is cut into two independent solids, both kept in the part.\n\n- With a datum plane the cut runs along that plane; with a face of a solid it runs along the infinite plane of that face (enlarged automatically so that it cuts through).\n- By default every body that crosses the tool is cut.\n- When the plane crosses no body at all, the feature fails and says so.\n- The resulting solids can be selected, suppressed or deleted one by one; faces keep their persistent names.',

  'help.split.keywords': 'split body cut plane datum plane',

  'help.split.see': 'concept.selection move-face import-step',

  // ---------------------------------------------------------------- assembly
  'help.insertComponent.summary': 'Inserts a part file into the assembly as a component.',

  'help.insertComponent.body':
    'Adds a part file (.3dbx) or another assembly (.3dba, which becomes a sub-assembly) to the assembly as a component.\n\n- Click one in the "Parts to insert" list, wait for it to load, and click an empty place in the 3D window to put it there; ✔ on the panel puts it at the origin.\n- The same part can be inserted many times; the names in the tree carry numbers: dowel<1>, dowel<2>.\n- A sub-assembly is rigid: its own mates do not change because of what is done outside, and the parts inside cannot be moved one by one here; open the sub-assembly to change them.\n- "Standard parts library": choose the kind (socket head screw ISO 4762, dowel pin ISO 8734, plain washer ISO 7089), the size and the length and add it; they are part files made with variables, and have no thread.',

  'help.insertComponent.keywords': 'insert component part sub-assembly standard library screw dowel washer',

  'help.insertComponent.see': 'new-assembly mate move-component',
  'help.mate.summary': 'Fixes the position of components relative to each other with mates (coincident, parallel, perpendicular, concentric, distance…).',

  'help.mate.body':
    'A mate says how faces, edges or vertices of two components lie against each other, which positions the parts.\n\n- Click, in the 3D window, elements on two different components (for example the cylinder of a pin, then the inside wall of a hole in the plate); datum planes and the origin are picked from the small tree in the top left corner of the view. With a sub-assembly you can click a face of a part inside it directly.\n- "Standard mates": coincident, parallel, perpendicular, tangent, concentric, lock, distance, angle. The program suggests one for the elements you picked (lit); the ones that cannot be used are grayed.\n- "Mate alignment" (aligned / anti-aligned) can be changed; distance and angle need a value, and can have a minimum and maximum limit.\n- "Advanced mates": width (two width faces and two tab faces), symmetric (two elements of one kind and a plane of symmetry).\n- When the panel says the mate holds, press ✔ to add it; when it says it contradicts the earlier mates and the assembly would be over-defined, do not add it.\n- The tree has a "Mates" folder with a row for each, showing its state.\n- In the tree, (f) before a name is fixed and (-) can move; the first component is fixed automatically.',

  'help.mate.keywords': 'mate coincident parallel perpendicular tangent concentric lock distance angle width symmetric position',

  'help.mate.see': 'move-component fix-component insert-component',
  'help.moveComponent.summary': 'Moves a component by dragging or by typing values.',

  'help.moveComponent.body':
    'Moves a component by dragging or by typing numbers; it also rotates (see "Rotate component").\n\n- Hold the left button on a component in the 3D window and drag; the component moves only along the freedoms its mates leave. Esc cancels the drag.\n- "By Delta XYZ": moves by ΔX, ΔY, ΔZ; "To XYZ position": moves the origin of the component to that position (assembly coordinates); press "Apply" or Enter after typing. Each move is one undo step.\n- "Collision detection (stop before contact)": when ticked, a component dragged against another stops before touching it and what it hit shows red; what already overlapped before the drag does not count.\n- A component that is fixed, fully defined by mates or suppressed cannot be moved, and the panel says why; nor can anything move while the exploded view is open, press "Collapse" first. A part inside a sub-assembly cannot be moved by itself.',

  'help.moveComponent.keywords': 'move component drag delta position collision freedom',

  'help.moveComponent.see': 'rotate-component mate fix-component',
  'help.rotateComponent.summary': 'Rotates a component.',

  'help.rotateComponent.body':
    'Turns a component: by dragging, or by typing angles about the X, Y and Z axes of the assembly.\n\n- Choose "Rotate" on the panel, then dragging a component in the 3D window turns it; dragging with the right button always turns. The component turns only about the freedoms its mates leave.\n- You can also type angles (degrees) about the X, Y and Z axes of the assembly and press "Apply"; each is one undo step.\n- A component that is fixed, fully defined by mates or suppressed cannot be turned.',

  'help.rotateComponent.keywords': 'rotate component turn angle drag right button',

  'help.rotateComponent.see': 'move-component mate fix-component',
  'help.explode.summary': 'Makes an exploded view: moves components apart along directions; it only changes the display, not where they are assembled.',

  'help.formSubAssembly.summary': 'Makes the components you pick, and the mates among them, into a new sub-assembly file.',

  'help.formSubAssembly.body':
    'In the "Form sub-assembly" panel tick the components to put in (at least two), type the file name and press ✔.\n\n- The new .3dba file is written next to the assembly; it holds those components (at the poses the mates have put them at) and the mates only among them; when none of them is fixed, the first is fixed inside the sub-assembly.\n- In the assembly the components are replaced by one component that stands for the sub-assembly, at the origin, so no part moves; when one of them was fixed, it is fixed too.\n- A mate with an end outside now goes through the sub-assembly (by a path to the part inside), and the outside positioning stays. The steps of the exploded views name the sub-assembly in place of those components.\n- It cannot be formed when a pattern or mirror is made of these components (their copies are worked out in the assembly); it says which one; and when the file name is taken, pick another.\n- A sub-assembly is rigid: to change a part or a mate inside, open that sub-assembly. Forming is one undo step, but the file that was written is not deleted by undo.',

  'help.formSubAssembly.keywords': 'form sub-assembly subassembly assembly components group',

  'help.formSubAssembly.see': 'insert-component mate explode',

  'help.explode.body':
    'Makes an exploded view: the components are drawn apart along directions. It is only a display; the true positions of the components do not change.\n\n- Tick the "components to move", choose the "direction" (an axis of the assembly, or an element of a component) and the "distance", and press "Add step"; the displacements of the steps add up.\n- "Explode" opens it and "Collapse" returns to the assembled picture exactly; opening and collapsing are half a second of animation, reversible, and one undo step works.\n- Tick "Show explode lines": every component that is moved has a dashed line from the middle of its parts where they are assembled through where each step puts it (as many legs as steps); it is a display choice, not kept in the file.\n- Steps can be edited ("Edit", "Update step"), reordered with "Up" and "Down", and deleted.\n- Nothing can be moved and no mate edited while it is open; press "Collapse" first. STEP output is always the assembled positions.\n- "Exploded views": an assembly can have several explodes (one to show how it goes together, one to take it apart, for example); the list chooses the one to show and edit, "Add one" and "Delete this one" add and delete, and the name can be changed; the steps, the explode lines and the animation belong to the one shown only, and are kept in the file (Undo takes back adding, deleting, renaming and switching).\n- Limits: only top-level components can be moved.',

  'help.explode.keywords': 'explode exploded view collapse steps',

  'help.explode.see': 'bom interference mate',
  'help.measureAssembly.summary': 'Measures distances and angles between the elements you pick in the assembly.',

  'help.measureAssembly.body':
    'Measures distances and angles between the elements picked in the assembly, in assembly coordinates.\n\n- Click elements in the 3D window (faces, edges, vertices, on different components if you like); after two are picked, picking another starts over, and picking an element again takes it off.\n- One element: a face gives its area, an edge its length, a circle its radius and diameter, a vertex its coordinates. Two elements: the shortest distance (0 when they touch), with ΔX, ΔY, ΔZ for two vertices; the angle is the acute one (0 to 90 degrees).\n- "Done" or Esc closes it.',

  'help.measureAssembly.keywords': 'measure assembly distance angle area radius coordinates',

  'help.measureAssembly.see': 'measure-part clearance interference',
  'help.clearance.summary': 'Checks that the smallest gap between components is large enough.',

  'help.clearance.body':
    'Checks whether the least clearance between components is enough, and works out the room a component has to be taken out.\n\n- Type a "Least clearance" and press "Check": it lists the pairs of components closer than that, with their distance (the exact shortest distance); touching is 0, sharing volume is marked "interference"; the place of the nearest points is listed too.\n- "Room to move": select a component first, choose a direction and a length, and press "Work out": how far it can move along that direction before it touches another component, and which one; when it already overlaps, it says it cannot move that way.\n- When the assembly was changed after the check, the result is stale; check again.',

  'help.clearance.keywords': 'clearance gap distance room to move interference',

  'help.clearance.see': 'interference check-assembly move-component',
  'help.interference.summary': 'Finds the volume where components overlap (touching does not count).',
  'help.interference.body':
    'Assembly > Interference Detection: the window lists each pair of components that share volume and how much, and the overlap is red in the 3D view; click a pair in the table to show only those two components, click again to show all.\n\n- By default the unit is the top-level component: a sub-assembly counts as one, and every copy of a pattern or mirror counts on its own.\n- Check "Also check the parts inside sub-assemblies" and every part counts on its own, so the parts inside a sub-assembly are compared with each other too; they are named "sub-assembly › part", and parts of one name in a sub-assembly are told apart by <2>, <3>.\n- Touching is not interference, and an overlap under 0.001 mm³ is not reported. Hidden components are checked, suppressed ones are not. After the model changes the window says so; press Check again.\n\nChecked example: the two sub-assemblies of the golden fixture, each with a locating plate and two pins whose shanks (radius 5) stand in the holes (radius 4) of the plate: checked inside, 4 pairs of about 405.4 mm³ each, 1621.6 in all; not checked inside, none.',
  'help.interference.keywords': 'interference overlap collision sub-assembly inside volume',
  'help.checkAssembly.summary': 'Checks that the geometry of the assembly is valid.',

  'help.checkAssembly.body':
    'Checks the model geometry of each kind of part in the assembly: a table with a row for each part file.\n\n- "Has a problem" means: the validity check did not pass, the shell is not closed (an open edge that belongs to one face only), or the volume is zero or negative.\n- It lists the solids, the faces, the faulty faces, the open edges and the volume; when all is well it says all are fine.\n- Imported STEP files and repaired models need it most; the numbers of the faulty faces are listed.',

  'help.checkAssembly.keywords': 'check geometry validity open edges shell volume',

  'help.checkAssembly.see': 'check-part clearance interference',
  'help.physicalAssembly.summary': 'Works out mass, center of mass and moments of inertia of the assembly.',

  'help.physicalAssembly.body':
    'Works out the mass, volume, surface area, center of mass and moments of inertia of the assembly, put together from the parts by their positions (the exploded view makes no difference).\n\n- The mass is complete only when every part has a material: a part with no material is left out of the total mass, and the window lists its name.\n- It lists the quantity and the mass of each part; parts not yet read are listed by name.\n- The surface area is the sum of the areas of the parts, not the area of the outside of the assembly.\n- Units: mass g, volume mm³, surface area mm², center mm, moments g·mm².',

  'help.physicalAssembly.keywords': 'physical properties assembly mass material center of mass inertia',

  'help.physicalAssembly.see': 'physical-part bom properties',
  'help.bom.summary': 'Makes the bill of materials (quantity, part number, supplier); can be written as CSV.',

  'help.bom.body':
    'Makes the parts list: it counts each kind of part in the assembly; the vendor and part number come from the "File properties" of the part files.\n\n- Two structures: "Parts only" (flattened, sub-assemblies expanded) and "Indented (with sub-assemblies)" (a sub-assembly is one row with its parts indented below it, the quantity being that of each level).\n- Columns: item, name, quantity, vendor, part number, file.\n- The instances of patterns and mirrors count in the quantity; suppressed components are left out, hidden ones are listed; reference parts (derived bodies) are left out.\n- Add the properties "Vendor" and "PartNo" to a part under Tools → File properties; they appear after saving and reopening the assembly.\n- "Export CSV" writes a .csv file to open in Excel.',

  'help.bom.keywords': 'bom parts list quantity part number vendor csv',

  'help.bom.see': 'properties explode physical-assembly',
  'help.patternLinear.summary': 'Repeats components along a direction.',

  'help.patternLinear.body':
    'Copies a component along one or two directions: the seed (the original) and its copies.\n\n- Select the seed component, choose "Direction 1" (the X, Y or Z axis of the assembly, or an element of a component), give the "number of instances (including the seed)" and the "spacing"; "Reverse direction" goes the other way.\n- "Add direction 2" adds another direction, making a grid; the numbers are "row × column".\n- "Instances to skip": numbers separated by commas to leave out.\n- The copies are derived from the seed: move the seed and they follow; hide or suppress it and they vanish; a copy cannot take mates of its own (pick the elements on the seed).\n- A pattern has a limited number of instances at most; the spacing has to be more than 0.\n\nExample: 4 dowels at a spacing of 40: the third is 80 mm from the seed.',

  'help.patternLinear.keywords': 'component pattern linear array seed instances spacing',

  'help.patternLinear.see': 'pattern-circular mirror-component insert-component',
  'help.patternCircular.summary': 'Repeats components around an axis.',

  'help.patternCircular.body':
    'Copies a component round an axis.\n\n- Select the seed component, and choose the "Axis" (the X, Y or Z axis of the assembly, or an element of a component: a straight edge, a cylindrical face or circular edge, a plane).\n- The "number of instances (including the seed)" and the "angle"; with "Equal spacing (the angle is the total)" the angle is shared by all the instances. "Reverse direction" turns the other way.\n- "Instances to skip" leaves some out.\n- The copies are derived from the seed, as in the linear pattern.\n\nExample: 4 dowels about the Z axis of the assembly, angle 90: 90° each turn.',

  'help.patternCircular.keywords': 'component pattern circular array axis angle seed',

  'help.patternCircular.see': 'pattern-linear mirror-component insert-component',
  'help.mirrorComponent.summary': 'Mirrors components.',

  'help.mirrorComponent.body':
    'Mirrors a component to the other side of a mirror plane as a rigid mirror image.\n\n- Select the component and choose the "Mirror plane": the front, top or right datum plane.\n- The mirror image is not saved in a file of its own: it is worked out from the original when the file is opened; it follows the original.\n- A mirror image is a row of its own in the parts list; it cannot take mates of its own.',

  'help.mirrorComponent.keywords': 'mirror component symmetric image parts list',

  'help.mirrorComponent.see': 'pattern-linear pattern-circular bom',
  'help.fixComponent.summary': 'Holds the component where it is, whatever the mates say.',

  'help.fixComponent.body':
    'Fixes a component at its present position: neither mates nor dragging move it.\n\n- The first component put into an assembly is fixed at the origin automatically; (f) before the name in the tree means fixed.\n- A fixed component cannot be dragged or turned, and the panel says it is fixed.\n- Use "Float" to make it movable again.',

  'help.fixComponent.keywords': 'fix component position origin',

  'help.fixComponent.see': 'float-component mate move-component',
  'help.floatComponent.summary': 'Lets a fixed component be moved by mates and by dragging.',

  'help.floatComponent.body':
    'Lets a fixed component be moved by mates and dragging.\n\n- (-) before the name in the tree means it can move.\n- A floating component is positioned by mates; in the directions no mate restrains it, it can be dragged freely.',

  'help.floatComponent.keywords': 'float component free move',

  'help.floatComponent.see': 'fix-component mate move-component',

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

  'help.toolCenterline.body':
    'In a sketch choose Sketch → Centerline: click to set the start, click again to set the end, and press Esc to finish.\n\n- A centerline is construction geometry (dashed): it is not part of the outline and is not extruded.\n- Use it as the axis of a revolve, or as the mirror line of the sketch "Mirror".\n- The start and the end can snap to sketch points, the origin, and edges and vertices of the model; see "Sketch snaps and inference".',

  'help.toolCenterline.keywords': 'centerline axis construction revolve axis mirror line',

  'help.toolCenterline.see': 'tool-line tool-mirror revolve',
  'help.toolRect.summary': 'Draws a rectangle from two opposite corners; its sides get horizontal and vertical relations.',

  'help.toolRect.body':
    'Click to set the first corner and click again to set the opposite corner; the rectangle is drawn (no dragging between the two clicks).\n\n- The four sides get horizontal and vertical relations automatically, so the rectangle is always upright; dimensions (with "Smart dimension") decide its size and place.\n- The corners can snap to sketch points, the origin, and edges and vertices of the model; see "Sketch snaps and inference".\n- To center it on the origin use "Center rectangle".',

  'help.toolRect.keywords': 'rectangle corner diagonal horizontal vertical',

  'help.toolRect.see': 'tool-centerRect tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolCenterRect.summary': 'Draws a rectangle from its center and a corner.',

  'help.toolCenterRect.body':
    'Click to set the center of the rectangle (the origin of the coordinates, for example) and click again to set a corner.\n\n- The rectangle is symmetric about its center, and the four sides get horizontal and vertical relations automatically.\n- The center can snap to the origin, sketch points and points of the model, so the rectangle is centered on it.',

  'help.toolCenterRect.keywords': 'center rectangle symmetric origin',

  'help.toolCenterRect.see': 'tool-rect tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolCircle.summary': 'Draws a circle: click the center, then the radius.',

  'help.toolCircle.body':
    'Click to set the center and click again to set the radius.\n\n- The center can snap to sketch points, the origin and points of the model (the center of a hole, for example).\n- Use "Smart dimension" to give the diameter and then the place of the center.\n- A circle is used for extruding (a cylinder); the "Hole" feature uses single points, not circles.',

  'help.toolCircle.keywords': 'circle center radius diameter',

  'help.toolCircle.see': 'tool-perimeterCircle tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolPerimeterCircle.summary': 'Draws a circle through three points on its circumference.',

  'help.toolPerimeterCircle.body':
    'Click three times, on three points of the circle: the first, the second, the third.\n\n- Three points on one line make no circle, and it says "Three points are collinear, cannot make a circle".\n- To draw by the center and the radius use "Circle".',

  'help.toolPerimeterCircle.keywords': 'perimeter circle three points circle',

  'help.toolPerimeterCircle.see': 'tool-circle tool-threePointArc concept.sketch-snaps tool-line sketch',
  'help.toolArc.summary': 'Draws an arc from its center, start and end.',

  'help.toolArc.body':
    'Click to set the center, click to set the start (which decides the radius) and click to set the end.\n\n- The two ends of the arc are sketch points, and other elements can join them.\n- The start and the end can snap to sketch points and points of the model.\n- The other ways: the "Tangent arc" (continuing from the end of a line or arc) and the "Three-point arc" (start, end, a point on the arc).',

  'help.toolArc.keywords': 'arc center start end',

  'help.toolArc.see': 'tool-tangentArc tool-threePointArc concept.sketch-snaps tool-line sketch',
  'help.toolTangentArc.summary': 'Draws an arc tangent to a line or arc at its end point.',

  'help.toolTangentArc.body':
    'Click the end of a line or arc and click again to set the end: an arc tangent to that line or arc is drawn, with a tangent relation added automatically.\n\n- The start has to be the end of a line or arc; otherwise it says "A tangent arc must start at the end of a line or arc".\n- Use it for outlines that join smoothly, such as a line, an arc and a line.',

  'help.toolTangentArc.keywords': 'tangent arc end smooth outline',

  'help.toolTangentArc.see': 'tool-arc tool-threePointArc concept.sketch-snaps tool-line sketch',
  'help.toolThreePointArc.summary': 'Draws an arc from its start, end and a point on it.',

  'help.toolThreePointArc.body':
    'Click to set the start, click to set the end and click a point on the arc: the arc through the three points is drawn.\n\n- Three points on one line make no arc, and it says "Three points are collinear, cannot make an arc".\n- Put the start and the end where the arc has to join, then pull out the bulge with the third.',

  'help.toolThreePointArc.keywords': 'three point arc start end point on arc',

  'help.toolThreePointArc.see': 'tool-arc tool-tangentArc concept.sketch-snaps tool-line sketch',
  'help.toolPoint.summary': 'Places a point.',

  'help.toolPoint.body':
    'Click to place a point.\n\n- "Hole" (and the screw boss, the snap hook and the vent) use the single points of a sketch as positions, not the ends of lines or centers of circles.\n- A point can snap to the origin and points of the model, and can be positioned with dimensions.\n- A single point is not part of an outline and is not extruded.',

  'help.toolPoint.keywords': 'point hole position location',

  'help.toolPoint.see': 'hole screw-boss concept.sketch-snaps tool-line sketch',
  'help.toolDimension.summary': 'Dimensions: pick one or two entities, click to place, type the value and press Enter.',
  'help.toolDimension.body': '- Pick a line for its length; a circle for its diameter and an arc for its radius (arc length: "Dimension arc length" in the panel); two lines for the angle; two points for the distance.\n- A dimension that would over-define the sketch becomes a driven dimension, shown in gray italics in parentheses, only showing what is measured; the dimension list in the panel can switch it between driven and driving.\n- Double-click a dimension to change it; the box takes an expression or an equation variable.',
  'help.toolSlot.summary': 'Draws the outline of a slot from two centers and a width.',

  'help.toolSlot.body':
    'Click to set the first center, click to set the second center, move the mouse to decide the width and click to finish.\n\n- The outline of a slot is two lines and two half circles: the sides are tangent to both arcs and the arcs have equal radii; the five freedoms that are left (the places of the two centers and the width) are decided with dimensions.\n- The two centers can snap to sketch points and points of the model.',

  'help.toolSlot.keywords': 'slot oblong centers width',

  'help.toolSlot.see': 'tool-circle tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolPolygon.summary': 'Draws a regular polygon; the number of sides and inscribed or circumscribed are set in the panel.',

  'help.toolPolygon.body':
    'Click to set the center of the polygon and click again to set the size and the direction.\n\n- The panel on the left sets the "number of sides" (6 at first) and "inscribed / circumscribed": when circumscribed the second click is the middle of a side, otherwise a corner.\n- The polygon is a construction circle, corners on the circle and equal sides; the four freedoms that are left (center, size, turn) are decided with dimensions.',

  'help.toolPolygon.keywords': 'polygon regular sides inscribed circumscribed hexagon',

  'help.toolPolygon.see': 'tool-circle tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolSketchFillet.summary': 'Rounds the corner of two lines (sketch fillet).',

  'help.toolSketchFillet.body':
    'Rounds the corner of two lines: click the corner point where two lines meet, or click the two lines in turn.\n\n- The panel on the left sets the "fillet radius" (5 at first); it has to be more than 0.\n- The two lines are shortened to where the arc touches them and the arc is tangent to both; the corner stays where it was as a virtual sharp, so a dimension that was given to the corner still holds. The radius itself is a dimension.\n- When the radius is too big and the arc would run beyond the length of a line, it says so and does nothing.\n- This is the fillet of a sketch; edges of a part are rounded with the "Fillet" feature.',

  'help.toolSketchFillet.keywords': 'sketch fillet round corner radius virtual sharp',

  'help.toolSketchFillet.see': 'tool-sketchChamfer fillet tool-trim',
  'help.toolSketchChamfer.summary': 'Bevels the corner of two lines (sketch chamfer).',

  'help.toolSketchChamfer.body':
    'Chamfers the corner of two lines: click the corner point where two lines meet, or click the two lines in turn.\n\n- The panel on the left sets the two "chamfer distances" (5 each at first): how far back along each line from the corner; they can differ, and have to be more than 0.\n- The two lines are shortened to those two points and joined by a new line; the corner stays where it was as a virtual sharp, and the two distances are dimensions measured from it.\n- When a distance is too big and would run beyond the length of a line, it says so and does nothing.\n- This is the chamfer of a sketch; edges of a part are chamfered with the "Chamfer" feature.',

  'help.toolSketchChamfer.keywords': 'sketch chamfer bevel corner distance virtual sharp',

  'help.toolSketchChamfer.see': 'tool-sketchFillet chamfer tool-trim',
  'help.toolTrim.summary': 'Trims: click a piece of a line between crossings to remove it.',

  'help.toolTrim.body':
    'Click the stretch to trim away: on a line, arc or circle, the part between the nearest two crossings (or ends) is removed.\n\n- When a stretch in the middle goes, the curve is split in two; the second piece takes over the horizontal, vertical, parallel, perpendicular and collinear relations, and the two pieces of an arc have equal radii. The new ends lie on the curves that cut them off.\n- A curve with no crossing at all is deleted with one click.\n- The length and the equalities of the whole curve go (it is not one whole curve any more).\n- Only lines, arcs and circles can be trimmed.',

  'help.toolTrim.keywords': 'trim cut crossing segment',

  'help.toolTrim.see': 'tool-extend tool-sketchFillet concept.sketch-snaps tool-line sketch',
  'help.toolExtend.summary': 'Extends: click the end of a line to lengthen it up to the line in its way.',

  'help.toolExtend.body':
    'Click near the end of a line or arc to extend: that end grows until it meets the first curve in its way.\n\n- The new end lies on that curve; the old end goes together with what was attached to it, and so do the length and the equalities of the whole curve.\n- An end that other elements also use (they share the point) cannot be extended, and it says so; separate them first.\n- When there is nothing ahead of the end to extend to, it says so too.\n- Only lines and arcs can be extended.',

  'help.toolExtend.keywords': 'extend lengthen end meet curve',

  'help.toolExtend.see': 'tool-trim tool-sketchFillet concept.sketch-snaps tool-line sketch',
  'help.toolOffset.summary': 'Offsets the selected entities to one side by a distance.',
  'help.toolOffset.body': 'Select the lines to offset, then press this command; the left panel has the offset distance. Pressed with nothing selected, the top of the panel asks you to select first.',
  'help.toolMirror.summary': 'Mirrors the selected entities about a line.',

  'help.toolMirror.body':
    'Select the elements to mirror first, press this command, and then click the mirror line (a line, which can be a centerline).\n\n- Each point gets a mirrored twin joined by a "symmetric" relation, so the image follows when the originals change; curves are built on the twins (an arc runs the other way round) and a circle\'s radius is kept equal. A point on the axis is its own twin.\n- The relations among the originals are not copied; the symmetry carries them over.\n- Without a selection first it says "Select the elements to mirror first"; when all the selected elements are on the axis it says there is nothing to mirror.\n- It returns to Select after one mirror.',

  'help.toolMirror.keywords': 'sketch mirror symmetric image centerline',

  'help.toolMirror.see': 'tool-centerline tool-offset concept.sketch-snaps tool-line sketch',
  'help.toolConvert.summary': 'Brings the edges or the outline of a face of the model into the sketch as entities that follow the model.',
  'help.toolConvert.body': 'When sketching on a face, press this and click an edge or a face of the model: an edge is projected into an entity; a face becomes its outline and holes. These entities are purple, their place is the model\'s, and they move when the model changes; if the edge is gone the sketch reports "missing reference".\n\nYou do not have to press it: moving the cursor onto an edge of the model while drawing also works, see "Sketch Snaps and Inference".',
  'help.toolConvert.see': 'concept.sketch-snaps tool-pierce',
  'help.toolPierce.summary': 'Puts a point where an edge of the model that crosses the sketch plane goes through it.',

  'help.toolPierce.body':
    'Places a point where an edge of the model, square to the sketch plane, pierces the sketch plane.\n\n- Press this command and click, in the view, a straight edge that goes through the sketch plane; a point appears where it passes through.\n- The point is a reference that follows the model: it moves when the model changes, and the sketch reports "lost reference" when the edge is gone.\n- Use it to find where the axis of a hole or the center line of a post meets the sketch plane.',

  'help.toolPierce.keywords': 'pierce point edge through sketch plane reference',

  'help.toolPierce.see': 'tool-convert concept.sketch-snaps hole',

  'help.toolIntersect.summary': 'Draws the curves where the sketch plane meets the model, as sketch geometry that follows the model.',

  'help.toolIntersect.body':
    'In a sketch, press it and pick faces or edges of the model in the graphics area; the tool works out where the sketch plane crosses them and builds lines or splines on the sketch.\n\n- A plane of the model crossing the sketch plane gives one line; curved faces and spline edges are sampled and projected into spline geometry.\n- The geometry remembers its source: when the model changes, it is recomputed and keeps its fix constraint.\n\nUnlike "Convert entities", which projects the picked edges themselves onto the sketch plane, this tool works out the intersection of a face with the sketch plane.',

  'help.toolIntersect.keywords': 'intersection convert entities projection spline sketch',

  'help.toolIntersect.see': 'tool-convert tool-pierce concept.selection',

  // ---------------------------------------------------------------- edit and view
  'help.undo.summary': 'Undoes the last change.',

  'help.undo.body':
    'Takes back the last change.\n\n- Shortcut Ctrl+Z; the "Undo" button is visible on every tab (gray means there is nothing to take back).\n- Each command is one undo step: a feature, a sketch operation (fillet, trim, mirror …), a move of a component each count as one.',

  'help.undo.keywords': 'undo step back Ctrl+Z',

  'help.undo.see': 'redo rebuild shortcuts',
  'help.redo.summary': 'Does again what was undone.',

  'help.redo.body':
    'Does again the change that was just taken back.\n\n- Shortcut Ctrl+Y; the "Redo" button is visible on every tab (gray means there is nothing to do again).',

  'help.redo.keywords': 'redo again Ctrl+Y',

  'help.redo.see': 'undo rebuild shortcuts',
  'help.rebuild.summary': 'Rebuilds the whole part.',

  'help.rebuild.body':
    'Recalculates the whole part: every feature is worked out again in order.\n\n- Normally it recalculates automatically after each change; use this command to force one more recalculation.\n- A feature that cannot be worked out turns red in the tree, the bottom of the window says "N errors", and "Why the error?" in the right-click menu of the row explains.',

  'help.rebuild.keywords': 'rebuild recalculate regenerate errors',

  'help.rebuild.see': 'undo concept.feature-tree',
  'help.fit.summary': 'Changes the view so that the whole model can be seen.',


  'help.fit.keywords': 'fit zoom view show all',

  'help.fit.see': 'view-iso view-front concept.overview',

  'help.filterBar.summary': 'Shows or hides the Selection Filter bar (a single choice, as in SolidWorks). F5.',

  'help.filterBar.body':
    'The Selection Filter bar lists faces / edges / vertices / planes as a single choice: click one kind and only that kind can be picked; clicking it again changes nothing.\n\n- The bar is hidden at first; press F5 to show it, F5 again or the ✕ on the bar to hide it.\n- Only a part window has the bar; an assembly does not.\n- The filter narrows what a command in progress asks for; it never widens it.',

  'help.filterBar.keywords': 'selection filter bar F5 single choice',

  'help.filterBar.see': 'clear-filters concept.selection',

  'help.clearFilters.summary': 'Clears the selection filters: every kind is pickable again. F6.',

  'help.clearFilters.body':
    'Press F6 or the Clear button on the filter bar to make faces, edges, vertices and planes all pickable again.\n\n- As SolidWorks\' Clear Selection Filters.\n- The bar stays; press F5 to hide it too.',

  'help.clearFilters.keywords': 'clear selection filters F6 all',

  'help.clearFilters.see': 'filter-bar concept.selection',
  'help.viewFront.summary': 'Shows the front view.',

  'help.viewFront.body':
    'Switches to the front view: seen from the front, orthographic (no perspective).\n\n- Clicking the "Front" face of the view cube at the top right of the 3D window does the same.\n- Dragging with the middle button (the wheel) turns the model freely, and the view cube turns with it.',

  'help.viewFront.keywords': 'front view orthographic',

  'help.viewFront.see': 'view-top view-right view-iso',
  'help.viewTop.summary': 'Shows the top view.',

  'help.viewTop.body':
    'Switches to the top view: seen from above, orthographic (no perspective).\n\n- Clicking the "Top" face of the view cube does the same.',

  'help.viewTop.keywords': 'top view orthographic',

  'help.viewTop.see': 'view-front view-right view-iso',
  'help.viewBack.summary': 'Shows the back view.',

  'help.viewBack.body': 'Switches to the back view: seen from behind (the other way from the front), orthographic (no perspective).\n\n- Shortcut Ctrl+2, as in SolidWorks.',

  'help.viewBack.keywords': 'back view rear orthographic',

  'help.viewBack.see': 'view-front concept.view',
  'help.viewBottom.summary': 'Shows the bottom view.',

  'help.viewBottom.body': 'Switches to the bottom view: seen from below (the other way from the top), orthographic (no perspective).\n\n- Shortcut Ctrl+6, as in SolidWorks.',

  'help.viewBottom.keywords': 'bottom view underside orthographic',

  'help.viewBottom.see': 'view-top concept.view',
  'help.viewLeft.summary': 'Shows the left view.',

  'help.viewLeft.body': 'Switches to the left view: seen from the left (the other way from the right), orthographic (no perspective).\n\n- Shortcut Ctrl+3, as in SolidWorks.',

  'help.viewLeft.keywords': 'left view side orthographic',

  'help.viewLeft.see': 'view-right concept.view',
  'help.viewRight.summary': 'Shows the right view.',

  'help.viewRight.body':
    'Switches to the right view: seen from the right, orthographic (no perspective).\n\n- Clicking the "Right" face of the view cube does the same.',

  'help.viewRight.keywords': 'right view orthographic',

  'help.viewRight.see': 'view-front view-top view-iso',
  'help.viewIso.summary': 'Shows the isometric view.',

  'help.viewIso.body':
    'Switches to the isometric view: seen obliquely from above, three faces can be seen at once.\n\n- It is the usual view for checking a shape while making features, and for seeing which face to click before sketching on it.\n- It is orthographic, without perspective.',

  'help.viewIso.keywords': 'isometric view 3d',

  'help.viewIso.see': 'view-front view-top fit',
  'help.viewNormal.summary': 'Normal To: looks squarely at the sketch plane or a selected plane; pressed again it flips to the far side; with nothing selected it turns to the standard view nearest to the current one.',

  'help.viewNormal.body':
    'Normal To: turns the view to look squarely at the sketch plane being edited.\n\n- Use it while sketching, so that the elements are not distorted by an oblique view.\n- Outside a sketch, select a reference plane or a flat face first, then press Normal To (Ctrl+8) to look straight at it.\n- While already looking straight at the plane, pressing again flips to the far side (and back).\n- With nothing selected, it turns to the standard view nearest to the current one (front, back, top, bottom, left, right); pressed while already straight along one, it goes to the other side.',

  'help.viewNormal.keywords': 'normal to view sketch plane square flip far side isometric',

  'help.viewNormal.see': 'sketch view-front fit view-iso',
  'help.drwStandard.summary': 'Places the front, top and right views at once.',
  'help.drwStandard.keywords': 'standard views front top right layout',
  'help.drwOpenPart.summary': 'Opens the part or assembly the drawing shows (the chosen view\'s, else the first view\'s); "Return to Drawing" in the part comes back.',
  'help.drwOpenPart.keywords': 'open part back to part switch document return to drawing model',
  'help.openDrawingPart.summary': 'Opens the part or assembly a drawing shows; the drawing\'s tree also has "Open part" at its top.',
  'help.openDrawingPart.keywords': 'open part back to part switch document return to drawing model',
  'help.drwProjected.summary': 'Draws projected views out of the chosen view; off a corner, the isometric from that corner, which turns with its parent.',
  'help.drwProjected.keywords': 'projected view orthographic first angle third angle',
  'help.drwSection.summary': 'Draw a section line on a view, then drag the section view where it goes.',
  'help.drwSection.keywords': 'section cut view',
  'help.drwDetail.summary': 'Draw a circle on a view to show what is inside it enlarged.',
  'help.drwDetail.keywords': 'detail view enlarged',
  'help.drwAutoscale.summary': 'Chooses a scale at which all the views and dimensions fit on the sheet.',
  'help.drwAutoscale.keywords': 'scale fit sheet',
  'help.drwDimension.summary': 'Pick one or two elements, then click where the dimension goes: faces, edges, vertices, circles.',
  'help.drwDimension.keywords': 'dimension smart distance diameter radius angle',
  'help.drwOrdinate.summary': 'Pick the origin, the elements to measure, then the paper: their places from one origin.',
  'help.drwOrdinate.keywords': 'ordinate baseline hole positions origin',
  'help.drwArrange.summary': 'Stacks all the linear dimensions outward by length; no value changes.',
  'help.drwArrange.keywords': 'arrange align overlap dimensions',
  'help.drwNote.summary': 'Puts text on the drawing, with a leader that can be fastened to the model.',
  'help.drwNote.keywords': 'note text leader',
  'help.drwDatum.summary': 'Puts a datum feature symbol on an edge or a vertex.',
  'help.drwDatum.keywords': 'datum GD&T',
  'help.drwFcf.summary': 'Puts an ISO 1101 feature control frame.',
  'help.drwFcf.keywords': 'geometric tolerance feature control frame GD&T',
  'help.drwCentreMark.summary': 'Puts a centre mark at the centre of a circle or an arc.',
  'help.drwCentreMark.keywords': 'centre mark center',
  'help.drwCentreLine.summary': 'Puts a centre line between two lines or on a cylinder.',
  'help.drwCentreLine.keywords': 'centre line axis symmetry',
  'help.drwSurface.summary': 'Puts a surface finish symbol on a view.',
  'help.drwSurface.keywords': 'surface finish roughness Ra',
  'help.drwHoleTable.summary': 'Lists the holes of the chosen view in a hole table.',
  'help.drwHoleTable.keywords': 'hole table positions',
  'help.drwBom.summary': 'Adds a parts list and balloons to a view of an assembly.',
  'help.drwBom.keywords': 'bom parts list balloons',
  'help.drwPdf.summary': 'Writes the drawing out as a PDF.',
  'help.drwPdf.keywords': 'pdf export print',
  'help.drwDxf.summary': 'Writes the drawing out as a DXF for CAD or a laser cutter.',
  'help.drwDxf.keywords': 'dxf export cad',
  'help.drwSvg.summary': 'Writes the drawing out as an SVG image.',
  'help.drwSvg.keywords': 'svg export image',
};
