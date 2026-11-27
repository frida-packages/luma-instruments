Class {
	#name : 'SceneCheck',
	#superclass : 'Object',
	#classInstVars : [
		'code',
		'view',
		'context',
		'opened'
	],
	#category : 'SceneCheck'
}

{ #category : 'loading' }
SceneCheck class >> load: aDirectoryName [
	| files |
	files := ((aDirectoryName asFileReference filesMatching: '*.st') asSortedCollection: [ :a :b | a basename <= b basename ]) asArray collect: [ :each |
		Dictionary new
			at: 'path' put: 'unity/' , each basename;
			at: 'source' put: each contents;
			yourself ].
	code := LumaInstrumentCode new.
	code install: files.
	^ code isSound
		ifTrue: [ 'loaded ' , files size printString , ' files: sound' ]
		ifFalse: [ 'REFUSED:' , String lf , code printString ]
]

{ #category : 'opening' }
SceneCheck class >> open [
	context := LumaViewContext new
		setView: (LumaInstrumentView new setID: 'scene-view-check'; yourself)
		instance: 'check'
		widget: 'hierarchy'
		named: 'hierarchy'.
	view := (code classNamed: 'SceneView') new.
	view openIn: context.
	view state: nil data: nil.
	^ self reportOn: view
]

{ #category : 'feeding' }
SceneCheck class >> feed: aJSON blob: aBlob size: aSize [
	| value bytes |
	value := STONJSON fromString: aJSON.
	bytes := LumaBytes fromJSON: { 'blob' -> aBlob. 'size' -> aSize } asDictionary.
	^ self timing: 'state:data:' of: [ view state: value data: bytes ]
]

{ #category : 'feeding' }
SceneCheck class >> inspection: aJSON [
	| value |
	value := STONJSON fromString: aJSON.
	^ self timing: 'event:data:' of: [ view event: value data: nil ]
]

{ #category : 'feeding' }
SceneCheck class >> clear [
	view state: nil data: nil.
	^ self reportOn: view
]

{ #category : 'feeding' }
SceneCheck class >> timing: aLabel of: aBlock [
	| started |
	started := Time microsecondClockValue.
	aBlock on: Error do: [ :error | ^ 'ERROR in ' , aLabel , ' ' , error description , String lf , (String lf join: ((error signalerContext stack first: 14) collect: [ :each | each printString ])) ].
	^ aLabel , ' ' , ((Time microsecondClockValue - started) / 1000.0 printShowingDecimalPlaces: 1) , ' ms'
]

{ #category : 'opening' }
SceneCheck class >> openNamed: aName [
	| object |
	object := (view instVarNamed: 'objects') detect: [ :each | each name = aName ].
	opened := view open: object.
	^ self reportOn: opened
]

{ #category : 'reporting' }
SceneCheck class >> reportView [
	^ self reportOn: view
]

{ #category : 'reporting' }
SceneCheck class >> reportComponents [
	^ String streamContents: [ :stream |
		stream nextPutAll: (self reportOn: opened).
		(opened instVarNamed: 'components') do: [ :each | stream lf; nextPutAll: 'component '; print: each; lf; nextPutAll: (self reportOn: each) ] ]
]

{ #category : 'reporting' }
SceneCheck class >> reportOn: anObject [
	| started views |
	started := Time microsecondClockValue.
	views := (((SwpViewCollector gtViewSelectorsFor: anObject) collect: [ :each | SwpViewCollector viewOf: anObject bySending: each ])
		reject: [ :each | each isKindOf: SwpEmptyView ]) asSortedCollection: [ :a :b | a priority <= b priority ].
	^ String streamContents: [ :stream |
		views do: [ :each | stream nextPutAll: (self describe: each); lf ].
		stream nextPutAll: '  (views of '; print: anObject class; nextPutAll: ' collected in '; nextPutAll: ((Time microsecondClockValue - started) / 1000.0 printShowingDecimalPlaces: 1); nextPutAll: ' ms)' ]
]

{ #category : 'reporting' }
SceneCheck class >> describe: aView [
	| declaration |
	declaration := aView declaration.
	^ String streamContents: [ :stream |
		stream nextPutAll: '  view '; print: (declaration at: #priority); space; nextPutAll: (declaration at: #viewName); nextPutAll: ' '''; nextPutAll: (declaration at: #title); nextPutAll: ''''.
		(aView respondsTo: #totalItems) ifTrue: [
			stream nextPutAll: ' rows '; print: aView totalItems.
			(aView itemsFrom: 1 count: 6) do: [ :row | stream lf; nextPutAll: '    '; nextPutAll: (' | ' join: (row collect: [ :cell | cell at: 'text' ])) ] ].
		(declaration includesKey: #text) ifTrue: [ stream lf; nextPutAll: (declaration at: #text) asString ] ]
]
