Class {
	#name : 'SceneView',
	#superclass : 'Object',
	#instVars : [
		'context',
		'scene',
		'objects',
		'roots',
		'byId',
		'takenAt',
		'tookMs',
		'place'
	],
	#category : 'Unity'
}

{ #category : 'initialization' }
SceneView >> initialize [
	self forget
]

{ #category : 'opening' }
SceneView >> openIn: aContext [
	context := aContext
]

{ #category : 'receiving' }
SceneView >> state: aValue data: someBytes [
	aValue ifNil: [
		self forget.
		^ context changed ].
	scene := aValue at: 'scene'.
	takenAt := aValue at: 'takenAt'.
	tookMs := aValue at: 'tookMs'.
	place := aValue at: 'place'.
	self read: someBytes.
	context changed
]

{ #category : 'receiving' }
SceneView >> forget [
	scene := nil.
	objects := #().
	roots := #().
	byId := nil
]

{ #category : 'receiving' }
SceneView >> read: someBytes [
	| lines parents read |
	lines := someBytes asByteArray utf8Decoded lines.
	someBytes release.
	read := OrderedCollection new: lines size.
	parents := OrderedCollection new.
	roots := OrderedCollection new.
	byId := nil.
	lines do: [ :line |
		| object |
		object := SceneObject fromCells: (line splitOn: Character tab) in: self.
		[ parents size > object depth ] whileTrue: [ parents removeLast ].
		parents isEmpty
			ifTrue: [ roots add: object ]
			ifFalse: [ parents last adopt: object ].
		parents addLast: object.
		read add: object ].
	objects := read asArray
]

{ #category : 'receiving' }
SceneView >> event: aValue data: someBytes [
	self objectsById
		at: (aValue at: 'inspected')
		ifPresent: [ :object | object takeComponents: (aValue at: 'components') shortened: (aValue at: 'shortened') ]
]

{ #category : 'receiving' }
SceneView >> objectsById [
	^ byId ifNil: [ byId := Dictionary newFromKeys: (objects collect: [ :each | each instanceId ]) andValues: objects ]
]

{ #category : 'opening' }
SceneView >> open: aSceneObject [
	context send: { 'inspect' -> aSceneObject instanceId } asDictionary.
	^ aSceneObject
]

{ #category : 'views' }
SceneView >> gtHierarchyFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Hierarchy';
		priority: 1;
		items: [ objects ];
		column: 'GameObject' do: [ :column |
			column
				text: [ :each | each indentedName ];
				weight: 3;
				minimumCharacters: 16 ];
		column: 'Active' do: [ :column |
			column
				text: [ :each | each activityText ];
				fitContent;
				priority: 2 ];
		column: 'Components' do: [ :column |
			column
				text: [ :each | each componentSummary ];
				weight: 2;
				priority: 3 ];
		column: '#' do: [ :column |
			column
				text: [ :each | each instanceId printString ];
				fitContent;
				priority: 1 ];
		send: [ :each | self open: each ]
]

{ #category : 'views' }
SceneView >> gtSummaryFor: aView [
	<gtView>
	^ aView text
		title: 'Summary';
		priority: 2;
		text: [ self summary ]
]

{ #category : 'views' }
SceneView >> summary [
	scene ifNil: [ ^ 'Waiting for the instrument to take this scene''s hierarchy.' ].
	^ String streamContents: [ :stream |
		stream
			nextPutAll: (scene at: 'name'); nextPutAll: ', build index '; print: (scene at: 'buildIndex'); lf;
			print: objects size; nextPutAll: ' GameObjects under '; print: roots size; nextPutAll: ' roots'; lf;
			nextPutAll: 'Taken at '; nextPutAll: self takenText; nextPutAll: ' in '; print: tookMs; nextPutAll: ' ms, ';
			nextPutAll: ((place = 'paused')
				ifTrue: [ 'while the game was paused' ]
				ifFalse: [ 'on the game''s main thread' ]); lf; lf;
			nextPutAll: 'Open a GameObject to read its components'' fields. Refresh takes the hierarchy again.' ]
]

{ #category : 'views' }
SceneView >> takenText [
	^ (DateAndTime fromUnixTime: takenAt // 1000) asLocal asTime print24
]
