Class {
	#name : 'GstCheck',
	#superclass : 'Object',
	#classInstVars : [
		'code',
		'view',
		'context'
	],
	#category : 'GstCheck'
}

{ #category : 'loading' }
GstCheck class >> load: aDirectoryName [
	| files |
	files := ((aDirectoryName asFileReference filesMatching: '*.st') asSortedCollection: [ :a :b | a basename <= b basename ]) asArray collect: [ :each |
		Dictionary new
			at: 'path' put: 'gstreamer/' , each basename;
			at: 'source' put: each contents;
			yourself ].
	code := LumaInstrumentCode new.
	code install: files.
	^ code isSound
		ifTrue: [ 'loaded ' , files size printString , ' files: sound' ]
		ifFalse: [ 'REFUSED:' , String lf , code printString ]
]

{ #category : 'opening' }
GstCheck class >> open [
	context := LumaViewContext new
		setView: (LumaInstrumentView new setID: 'pipeline-graph-check'; yourself)
		instance: 'check'
		widget: 'graph'
		named: 'Graph'.
	view := (code classNamed: 'PipelineGraphView') new.
	view openIn: context.
	view state: nil data: nil.
	^ self report
]

{ #category : 'feeding' }
GstCheck class >> feed: aJSON blob: aBlob size: aSize [
	| value bytes started time |
	value := STONJSON fromString: aJSON.
	bytes := LumaBytes fromJSON: { 'blob' -> aBlob. 'size' -> aSize } asDictionary.
	started := Time microsecondClockValue.
	[ view state: value data: bytes ] on: Error do: [ :error | ^ 'ERROR in state:data: ' , error description , String lf , (String lf join: ((error signalerContext stack first: 14) collect: [ :each | each printString ])) ].
	time := Time microsecondClockValue - started.
	^ 'state:data: ' , (time / 1000.0 printShowingDecimalPlaces: 1) , ' ms'
]

{ #category : 'feeding' }
GstCheck class >> clear [
	view state: nil data: nil.
	^ self report
]

{ #category : 'reporting' }
GstCheck class >> report [
	^ String streamContents: [ :stream |
		self declarations do: [ :each | stream nextPutAll: each; lf ] ]
]

{ #category : 'reporting' }
GstCheck class >> declarations [
	| views |
	views := (((SwpViewCollector gtViewSelectorsFor: view) collect: [ :each | SwpViewCollector viewOf: view bySending: each ])
		reject: [ :each | each isKindOf: SwpEmptyView ]) asSortedCollection: [ :a :b | a priority <= b priority ].
	^ views collect: [ :each | self describe: each ]
]

{ #category : 'reporting' }
GstCheck class >> describe: aView [
	| declaration |
	declaration := aView declaration.
	^ String streamContents: [ :stream |
		stream nextPutAll: '  view '; print: (declaration at: #priority); space; nextPutAll: (declaration at: #viewName); nextPutAll: ' '''; nextPutAll: (declaration at: #title); nextPutAll: ''''.
		(aView respondsTo: #totalItems) ifTrue: [
			stream nextPutAll: ' rows '; print: aView totalItems.
			(aView itemsFrom: 1 count: 3) do: [ :row | stream lf; nextPutAll: '    '; nextPutAll: (' | ' join: (row collect: [ :cell | cell at: 'text' ])) ] ].
		(declaration includesKey: #text) ifTrue: [ stream nextPutAll: ' text '; print: (declaration at: #text) size; nextPutAll: ' characters' ] ]
]

{ #category : 'reporting' }
GstCheck class >> counts [
	| snapshot |
	snapshot := view instVarNamed: 'snapshot'.
	^ String streamContents: [ :stream |
		stream
			nextPutAll: 'elements '; print: snapshot elements size - 1;
			nextPutAll: ' bins '; print: (snapshot elements count: [ :each | each isBin ]) - 1;
			nextPutAll: ' pads '; print: (snapshot pads count: [ :each | each isProxy not ]);
			nextPutAll: ' proxies '; print: (snapshot pads count: [ :each | each isProxy ]);
			nextPutAll: ' ghosts '; print: (snapshot pads count: [ :each | each isGhost ]);
			nextPutAll: ' links '; print: snapshot links size;
			nextPutAll: ' layout '; print: (view instVarNamed: 'layout') identityHash; lf.
		(snapshot links collect: [ :each | 'link ' , each from fullName , ' -> ' , each to fullName , ' [' , each mediaType , ']' ]) asSortedCollection do: [ :each | stream nextPutAll: each; lf ].
		(snapshot elements allButFirst collect: [ :each | 'element ' , each path , ' ' , each type , ' ' , each stateText ]) asSortedCollection do: [ :each | stream nextPutAll: each; lf ] ]
]

{ #category : 'checking' }
GstCheck class >> geometry [
	| snapshot layout problems |
	snapshot := view instVarNamed: 'snapshot'.
	layout := view instVarNamed: 'layout'.
	problems := OrderedCollection new.
	snapshot elements select: [ :each | each isBin ] thenDo: [ :bin |
		bin children do: [ :a |
			bin children do: [ :b |
				(a ~~ b and: [ (layout frameOf: a) intersects: (layout frameOf: b) ]) ifTrue: [ problems add: 'siblings overlap: ' , a name , ' ' , b name ] ].
			((layout frameOf: bin) containsRect: (layout frameOf: a)) ifFalse: [ problems add: 'child outside its bin: ' , a name ] ] ].
	snapshot pads do: [ :pad |
		| frame owner |
		frame := layout frameOf: pad.
		owner := layout frameOf: pad element.
		(pad isGhost or: [ pad isProxy ])
			ifTrue: [ (owner intersects: frame) ifFalse: [ problems add: 'ghost or proxy pad away from its bin: ' , pad fullName ] ]
			ifFalse: [ (owner containsRect: frame) ifFalse: [ problems add: 'pad outside its element: ' , pad fullName ] ] ].
	snapshot links do: [ :link |
		| route |
		route := layout routeOf: link.
		((route start x - (layout frameOf: link from) right) abs < 0.01 and: [ route start y between: (layout frameOf: link from) top and: (layout frameOf: link from) bottom ])
			ifFalse: [ problems add: 'link does not leave its source pad edge: ' , link printString ].
		((route tip x - (layout frameOf: link to) left) abs < 0.01 and: [ route tip y between: (layout frameOf: link to) top and: (layout frameOf: link to) bottom ])
			ifFalse: [ problems add: 'link does not reach its sink pad edge: ' , link printString ] ].
	snapshot links do: [ :link |
		| allowed points |
		allowed := (self lineageOf: link from element) , (self lineageOf: link to element).
		points := self densePointsOf: (layout routeOf: link).
		snapshot elements do: [ :element |
			((allowed includes: element) not and: [ points anySatisfy: [ :point | ((layout frameOf: element) insetBy: 1) containsPoint: point ] ])
				ifTrue: [ problems add: 'crossing: ' , link printString , ' runs through ' , element printString ] ] ].
	(snapshot elements , snapshot pads) do: [ :each |
		| picked |
		picked := layout keyAt: (self pickPointOf: each in: layout) within: 1.
		picked = each key ifFalse: [ problems add: 'picking ' , each printString , ' found ' , picked printString ] ].
	snapshot links do: [ :each |
		((layout routeOf: each) points anySatisfy: [ :point | (layout keyAt: point within: 1) = each key ])
			ifFalse: [ problems add: 'no point of link ' , each printString , ' picks it' ] ].
	problems add: (self overlapsIn: snapshot laidOut: layout).
	^ problems size = 1
		ifTrue: [ problems first , String lf , 'geometry: no problems over ' , snapshot elements size printString , ' elements, ' , snapshot pads size printString , ' pads, ' , snapshot links size printString , ' links; bounds ' , layout bounds printString ]
		ifFalse: [ String lf join: problems ]
]

{ #category : 'checking' }
GstCheck class >> lineageOf: anElement [
	anElement ifNil: [ ^ #() ].
	^ { anElement } , (self lineageOf: anElement parent)
]

{ #category : 'checking' }
GstCheck class >> densePointsOf: aRoute [
	| points |
	points := OrderedCollection new.
	aRoute points overlappingPairsDo: [ :a :b | 0 to: 7 do: [ :step | points add: a + ((b - a) * (step / 8)) ] ].
	points add: aRoute points last.
	^ points
]

{ #category : 'checking' }
GstCheck class >> overlapsIn: aSnapshot laidOut: aLayout [
	| boxes labels crossings pairs |
	pairs := OrderedCollection new.
	boxes := (aSnapshot links collect: [ :each | each -> (aLayout routeOf: each) labelBox ]) reject: [ :each | each value area = 0 ].
	labels := 0.
	crossings := 0.
	boxes doWithIndex: [ :a :index |
		(boxes allButFirst: index) do: [ :b | (a value intersects: b value) ifTrue: [
			labels := labels + 1.
			pairs add: 'labels overlap: ' , a key printString , ' and ' , b key printString ] ] ].
	aSnapshot links do: [ :link |
		| points |
		points := self densePointsOf: (aLayout routeOf: link).
		boxes do: [ :box | (box key ~~ link and: [ points anySatisfy: [ :point | box value containsPoint: point ] ]) ifTrue: [ crossings := crossings + 1 ] ] ].
	^ String lf join: { 'overlaps: ' , labels printString , ' label/label, ' , crossings printString , ' link behind a label' } , pairs
]

{ #category : 'checking' }
GstCheck class >> pickPointOf: anObject in: aLayout [
	| frame |
	(anObject respondsTo: #from) ifTrue: [ ^ (aLayout routeOf: anObject) points at: 13 ].
	frame := aLayout frameOf: anObject.
	(anObject respondsTo: #children) ifTrue: [ ^ frame origin + (frame width / 2 @ 3) ].
	^ frame center
]

{ #category : 'steering' }
GstCheck class >> input: aJSON [
	view input: (LumaInputEvent fromJSON: (STONJSON fromString: aJSON)).
	^ self caption
]

{ #category : 'steering' }
GstCheck class >> clickOn: aName width: aWidth height: aHeight [
	| snapshot layout camera target screen clip |
	snapshot := view instVarNamed: 'snapshot'.
	layout := view instVarNamed: 'layout'.
	camera := view instVarNamed: 'camera'.
	target := (snapshot elements , snapshot pads , snapshot links) detect: [ :each | each printString = aName ].
	camera instVarNamed: 'center' put: (self pickPointOf: target in: layout).
	camera instVarNamed: 'zoom' put: 1.
	(view instVarNamed: 'scene') aim: camera.
	screen := ((self pointOn: target in: layout tolerance: (camera toleranceIn: aWidth @ aHeight)) - camera centerNow) * (camera zoomIn: aWidth @ aHeight) + (aWidth @ aHeight / 2).
	clip := (screen x / aWidth * 2 - 1) @ (1 - (screen y / aHeight * 2)).
	#( 'down' 'up' ) do: [ :kind | view input: (LumaInputEvent fromJSON: (self eventOf: kind at: clip width: aWidth height: aHeight)) ].
	^ 'clicked ' , aName , ': selection ' , (view instVarNamed: 'selection') printString
]

{ #category : 'steering' }
GstCheck class >> clickScreen: aPoint width: aWidth height: aHeight [
	| clip |
	(view instVarNamed: 'camera') fit.
	(view instVarNamed: 'scene') aim: (view instVarNamed: 'camera').
	clip := (aPoint x / aWidth * 2 - 1) @ (1 - (aPoint y / aHeight * 2)).
	[ #( 'down' 'up' ) do: [ :kind | view input: (LumaInputEvent fromJSON: (self eventOf: kind at: clip width: aWidth height: aHeight)) ] ] on: Error do: [ :error | ^ 'ERROR ' , error description , String lf , (String lf join: ((error signalerContext stack first: 10) collect: [ :each | each printString ])) ].
	^ 'clicked the screen at ' , aPoint printString , ': selection ' , (view instVarNamed: 'selection') printString
]

{ #category : 'steering' }
GstCheck class >> pointOn: anObject in: aLayout tolerance: aDistance [
	(anObject respondsTo: #from) ifFalse: [ ^ self pickPointOf: anObject in: aLayout ].
	^ (aLayout routeOf: anObject) points
		detect: [ :each | (aLayout keyAt: each within: aDistance) = anObject key ]
		ifNone: [ (aLayout routeOf: anObject) points at: 4 ]
]

{ #category : 'steering' }
GstCheck class >> eventOf: aKind at: aPoint width: aWidth height: aHeight [
	^ Dictionary new
		at: 'kind' put: aKind;
		at: 'x' put: aPoint x;
		at: 'y' put: aPoint y;
		at: 'buttons' put: (aKind = 'down' ifTrue: [ 1 ] ifFalse: [ 0 ]);
		at: 'dx' put: 0;
		at: 'dy' put: 0;
		at: 'factor' put: 1;
		at: 'key' put: 0;
		at: 'width' put: aWidth;
		at: 'height' put: aHeight;
		yourself
]

{ #category : 'steering' }
GstCheck class >> caption [
	^ 'camera ' , (view instVarNamed: 'camera') uniform printString , ' selection ' , (view instVarNamed: 'selection') printString
]

{ #category : 'accessing' }
GstCheck class >> sceneHandle [
	^ (view instVarNamed: 'scene') handle
]

{ #category : 'steering' }
GstCheck class >> focus: aName zoom: aZoom [
	| snapshot layout camera target |
	snapshot := view instVarNamed: 'snapshot'.
	layout := view instVarNamed: 'layout'.
	camera := view instVarNamed: 'camera'.
	target := (snapshot elements , snapshot pads) detect: [ :each | each name = aName ].
	camera instVarNamed: 'center' put: (layout frameOf: target) center.
	camera instVarNamed: 'zoom' put: aZoom.
	(view instVarNamed: 'scene') aim: camera.
	^ 'focused on ' , target printString
]

{ #category : 'reporting' }
GstCheck class >> profile [
	| dot graph snapshot layout scene times |
	dot := (view instVarNamed: 'snapshot') top dot.
	scene := view instVarNamed: 'scene'.
	times := OrderedCollection new.
	times add: 'parse ' -> (Time millisecondsToRun: [ graph := (code classNamed: 'DotParser') parse: dot ]).
	times add: 'read ' -> (Time millisecondsToRun: [ snapshot := (code classNamed: 'PipelineReader') read: graph dot: dot address: '0x1' ]).
	times add: 'layout ' -> (Time millisecondsToRun: [ layout := (code classNamed: 'PipelineLayout') of: snapshot measuredBy: scene lettering ]).
	times add: 'meshes ' -> (Time millisecondsToRun: [ scene draw: snapshot laidOut: layout ]).
	scene draw: (view instVarNamed: 'snapshot') laidOut: (view instVarNamed: 'layout').
	^ ' ' join: (times collect: [ :each | each key , each value printString , ' ms' ])
]
