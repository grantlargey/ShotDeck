# ScriptDeck

ScriptDeck is for studying films through their scripts: admins capture scenes from a film's script, record where each scene falls in the film, and tag them.

## Language

### Scripts and captured scenes

**Script**:
The screenplay document attached to a film, from which scenes are captured.
_Avoid_: Screenplay PDF, script file

**Captured scene**:
A saved scene from a script, made up of its script location, scene text, raw text, film timing, and tags.
_Avoid_: Scene annotation, script annotation, script scene

**Script location**:
Where a captured scene sits in its script: its pages and, when recorded, its scene anchors, text offsets, and surrounding text.
_Avoid_: Anchor (for the whole location), selection

**Film timing**:
The start and end time within the film that a captured scene covers.
_Avoid_: Time range, timestamps

**Overlapping scenes**:
Captured scenes of the same script whose film timings share any moment besides the point where one ends and the other begins, or whose script locations share a line. Scenes can't overlap; scenes that only touch are fine.
_Avoid_: Conflicting scenes, time collision

**Legacy scene**:
A captured scene whose script location has no usable pair of scene anchors, such as one saved before anchors existed.
_Avoid_: Old scene, unanchored scene

**Scene text**:
The screenplay-formatted text shown for a captured scene. A captured scene without it currently shows its raw text or older stored text instead.
_Avoid_: Formatted text, selected text, markdown

**Raw text**:
Plain text stored alongside the scene text. It is usually the words of the captured text. Without captured text from the current anchors, saving keeps the captured scene's existing raw text when it has some, and otherwise derives it from the scene text.
_Avoid_: Verbatim text, PDF text, original text

### Capturing a scene

**Scene draft**:
The captured scene an admin is creating or editing, before it is saved.
_Avoid_: Annotation, scene form, draft scene

**Scene anchor**:
The first line (start anchor) or last line (end anchor) of a scene in its script.
_Avoid_: Marker, selection handle

**Suggested anchors**:
Scene anchors proposed by matching a saved scene's text against its script. They are shown on a scene draft but are not part of it until the admin changes the anchors or re-captures.
_Avoid_: Automatic anchors, guessed anchors

**Captured text**:
The text between a scene draft's anchors, read from the script and laid out as screenplay text.
_Avoid_: Selection, extracted text

**Re-capture**:
Replacing a scene draft's text with fresh captured text from its current anchors.
_Avoid_: Refresh

**Text origin**:
Where a scene draft's text came from: Captured, Edited, Saved, or AI formatted.
_Avoid_: Text source, text status

**Stale text**:
Scene draft text whose scene anchors no longer match the current ones, such as after the anchors move without a re-capture, or a legacy scene's text once suggested anchors appear.
_Avoid_: Stale capture, outdated capture

**AI proposal**:
Screenplay text the AI formatter suggests for a scene draft; it changes nothing until the admin accepts it.
_Avoid_: AI format, AI suggestion, formatting result

### Films

**Still**:
An image from a film, placed at one moment of the film.
_Avoid_: Annotation, image annotation
