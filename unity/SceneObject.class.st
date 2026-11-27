Class {
	#name : 'SceneObject',
	#superclass : 'Object',
	#instVars : [
		'view',
		'depth',
		'instanceId',
		'activeSelf',
		'activeInHierarchy',
		'layer',
		'tag',
		'name',
		'componentTypes',
		'components',
		'parent',
		'children',
		'state'
	],
	#category : 'Unity'
}

{ #category : 'instance creation' }
SceneObject class >> fromCells: someCells in: aSceneView [
	^ self new setCells: someCells in: aSceneView
]

{ #category : 'initialization' }
SceneObject >> setCells: someCells in: aSceneView [
	view := aSceneView.
	depth := someCells first asInteger.
	instanceId := (someCells at: 2) asInteger.
	activeSelf := (someCells at: 3) first = $1.
	activeInHierarchy := (someCells at: 3) last = $1.
	layer := (someCells at: 4) asInteger.
	tag := someCells at: 5.
	name := someCells at: 6.
	componentTypes := someCells allButFirst: 6.
	children := #().
	state := #unread
]

{ #category : 'accessing' }
SceneObject >> depth [
	^ depth
]

{ #category : 'accessing' }
SceneObject >> instanceId [
	^ instanceId
]

{ #category : 'accessing' }
SceneObject >> name [
	^ name
]

{ #category : 'accessing' }
SceneObject >> components [
	^ components ifNil: [ components := componentTypes asArray collect: [ :each | SceneComponent type: each on: self ] ]
]

{ #category : 'building' }
SceneObject >> adopt: aSceneObject [
	children isEmpty ifTrue: [ children := OrderedCollection new ].
	children add: aSceneObject.
	aSceneObject setParent: self
]

{ #category : 'building' }
SceneObject >> setParent: aSceneObject [
	parent := aSceneObject
]

{ #category : 'inspecting' }
SceneObject >> takeComponents: someComponents shortened: isShortened [
	someComponents
		ifNil: [ state := #gone ]
		ifNotNil: [
			state := isShortened ifTrue: [ #shortened ] ifFalse: [ #read ].
			self matchComponents: someComponents ].
	self lumaChanged.
	self components do: [ :each | each lumaChanged ]
]

{ #category : 'inspecting' }
SceneObject >> matchComponents: someComponents [
	(someComponents collect: [ :each | each at: 'type' ]) asArray = componentTypes asArray
		ifFalse: [
			componentTypes := someComponents collect: [ :each | each at: 'type' ].
			components := nil ].
	self components with: someComponents do: [ :component :read | component takeFields: (read at: 'fields') ]
]

{ #category : 'printing' }
SceneObject >> indentedName [
	^ (String new: depth * 2 withAll: Character space) , self displayName
]

{ #category : 'printing' }
SceneObject >> displayName [
	^ name isEmpty ifTrue: [ '(unnamed)' ] ifFalse: [ name ]
]

{ #category : 'printing' }
SceneObject >> activityText [
	activeInHierarchy ifTrue: [ ^ 'yes' ].
	^ activeSelf ifTrue: [ 'parent off' ] ifFalse: [ 'no' ]
]

{ #category : 'printing' }
SceneObject >> componentSummary [
	^ ', ' join: ((componentTypes reject: [ :each | SceneComponent isTransformType: each ]) collect: [ :each | SceneComponent shortTypeOf: each ])
]

{ #category : 'printing' }
SceneObject >> path [
	^ parent
		ifNil: [ self displayName ]
		ifNotNil: [ :above | above path , '/' , self displayName ]
]

{ #category : 'printing' }
SceneObject >> stateText [
	state = #unread ifTrue: [ ^ 'reading its components…' ].
	state = #gone ifTrue: [ ^ 'gone: no object has this instance id any more; Refresh the scene' ].
	state = #shortened ifTrue: [ ^ 'read, with the last fields left out to fit one message' ].
	^ 'read'
]

{ #category : 'printing' }
SceneObject >> printOn: aStream [
	aStream nextPutAll: self displayName
]

{ #category : 'views' }
SceneObject >> gtComponentsFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Components';
		priority: 1;
		items: [ self components ];
		column: 'Component' do: [ :column |
			column
				text: [ :each | each shortType ];
				weight: 2 ];
		column: 'Fields' do: [ :column |
			column
				text: [ :each | each fieldsText ];
				fitContent ];
		column: 'Type' do: [ :column |
			column
				text: [ :each | each type ];
				weight: 3;
				priority: 1 ]
]

{ #category : 'views' }
SceneObject >> gtChildrenFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Children';
		priority: 2;
		items: [ children ];
		column: 'GameObject' do: [ :column |
			column
				text: [ :each | each displayName ];
				weight: 2 ];
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
		send: [ :each | view open: each ]
]

{ #category : 'views' }
SceneObject >> gtSummaryFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Summary';
		priority: 3;
		items: [ self summary ];
		column: 'Property' do: [ :column |
			column
				text: [ :each | each key ];
				fitContent ];
		column: 'Value' text: [ :each | each value ]
]

{ #category : 'views' }
SceneObject >> summary [
	^ {
		'Path' -> self path.
		'Instance id' -> instanceId printString.
		'Active' -> self activityText.
		'Layer' -> layer printString.
		'Tag' -> tag.
		'Children' -> children size printString.
		'Components' -> self stateText.
		'In the console' -> ('unityObject(' , instanceId printString , ')') }
]
