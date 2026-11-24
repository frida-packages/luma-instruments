Class {
	#name : 'PipelineElement',
	#superclass : 'Object',
	#instVars : [
		'address',
		'name',
		'type',
		'state',
		'pending',
		'properties',
		'role',
		'pads',
		'parent'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
PipelineElement class >> address: anAddress label: aLabel role: aRole in: aBin [
	^ self new setAddress: anAddress label: aLabel role: aRole in: aBin
]

{ #category : 'initialization' }
PipelineElement >> setAddress: anAddress label: aLabel role: aRole in: aBin [
	| fields |
	fields := aLabel fields.
	address := anAddress.
	type := fields first copyWithoutAll: '<>'.
	name := fields second.
	state := self stateAt: 2 in: fields third.
	pending := self pendingIn: fields third.
	properties := aLabel properties.
	role := aRole.
	pads := OrderedCollection new.
	parent := aBin
]

{ #category : 'initialization' }
PipelineElement >> pendingIn: aField [
	aField size > 3 ifFalse: [ ^ 'void-pending' ].
	^ self stateAt: aField size - 1 in: aField
]

{ #category : 'initialization' }
PipelineElement >> stateAt: anIndex in: aField [
	^ #( 'void-pending' 'null' 'ready' 'paused' 'playing' ) at: ('~0-=>' indexOf: (aField at: anIndex))
]

{ #category : 'building' }
PipelineElement >> addPad: aPad [
	pads add: aPad
]

{ #category : 'printing' }
PipelineElement >> printOn: aStream [
	aStream nextPutAll: name; nextPutAll: ' ('; nextPutAll: type; nextPut: $)
]

{ #category : 'views' }
PipelineElement >> gtSummaryFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Summary';
		priority: 1;
		items: [ self summary ];
		column: 'Property' text: [ :each | each key ];
		column: 'Value' text: [ :each | each value displayString ];
		send: [ :each | each value ]
]

{ #category : 'views' }
PipelineElement >> gtPadsFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Pads';
		priority: 3;
		items: [ pads ];
		column: 'Pad' text: [ :each | each name ];
		column: 'Direction' text: [ :each | each direction ];
		column: 'Kind' text: [ :each | each kind ];
		column: 'Flags' text: [ :each | each flagText ];
		column: 'Peer' text: [ :each | each peerText ]
]

{ #category : 'views' }
PipelineElement >> gtPeersFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Peers';
		priority: 4;
		items: [ self linkedPads ];
		column: 'Through' text: [ :each | each peer name ];
		column: 'Peer' text: [ :each | each fullName ];
		column: 'Media type' text: [ :each | each link mediaType ];
		send: [ :each | each element ]
]

{ #category : 'views' }
PipelineElement >> gtPropertiesFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Properties';
		priority: 5;
		items: [ properties ];
		column: 'Property' text: [ :each | each key ];
		column: 'Value' text: [ :each | each value ]
]

{ #category : 'accessing' }
PipelineElement >> summary [
	^ {
		'Name' -> name.
		'Type' -> type.
		'State' -> self stateText.
		'Bin' -> (parent ifNil: [ '' ]).
		'Pads' -> pads size printString.
		'Address' -> address }
]

{ #category : 'accessing' }
PipelineElement >> stateText [
	pending = 'void-pending' ifTrue: [ ^ state ].
	^ state , ' → ' , pending
]

{ #category : 'accessing' }
PipelineElement >> linkedPads [
	^ (pads select: [ :each | each link notNil ]) collect: [ :each | each peer ]
]

{ #category : 'accessing' }
PipelineElement >> address [
	^ address
]

{ #category : 'accessing' }
PipelineElement >> key [
	^ address
]

{ #category : 'accessing' }
PipelineElement >> name [
	^ name
]

{ #category : 'accessing' }
PipelineElement >> type [
	^ type
]

{ #category : 'accessing' }
PipelineElement >> state [
	^ state
]

{ #category : 'accessing' }
PipelineElement >> pending [
	^ pending
]

{ #category : 'accessing' }
PipelineElement >> properties [
	^ properties
]

{ #category : 'accessing' }
PipelineElement >> role [
	^ role
]

{ #category : 'accessing' }
PipelineElement >> pads [
	^ pads
]

{ #category : 'accessing' }
PipelineElement >> parent [
	^ parent
]

{ #category : 'accessing' }
PipelineElement >> children [
	^ #()
]

{ #category : 'accessing' }
PipelineElement >> isBin [
	^ false
]

{ #category : 'accessing' }
PipelineElement >> binPath [
	parent ifNil: [ ^ '' ].
	^ parent path
]

{ #category : 'accessing' }
PipelineElement >> path [
	parent ifNil: [ ^ name ].
	^ parent path , ' / ' , name
]

{ #category : 'accessing' }
PipelineElement >> depth [
	parent ifNil: [ ^ 0 ].
	^ parent depth + 1
]

{ #category : 'highlighting' }
PipelineElement >> linkedObjects [
	^ { self } , (pads flatCollect: [ :each | each farObjects ])
]
