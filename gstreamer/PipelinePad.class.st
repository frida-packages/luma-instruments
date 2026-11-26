Class {
	#name : 'PipelinePad',
	#superclass : 'Object',
	#instVars : [
		'address',
		'name',
		'direction',
		'kind',
		'presence',
		'flagText',
		'properties',
		'element',
		'link',
		'partner'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
PipelinePad class >> address: anAddress label: aLabel direction: aDirection kind: aKind presence: aPresence of: anElement [
	^ self new setAddress: anAddress label: aLabel direction: aDirection kind: aKind presence: aPresence of: anElement
]

{ #category : 'initialization' }
PipelinePad >> setAddress: anAddress label: aLabel direction: aDirection kind: aKind presence: aPresence of: anElement [
	address := anAddress.
	name := aLabel fields first.
	flagText := aLabel trailingField.
	properties := aLabel properties.
	direction := aDirection.
	kind := aKind.
	presence := aPresence.
	element := anElement
]

{ #category : 'building' }
PipelinePad >> link: aLink [
	link := aLink
]

{ #category : 'building' }
PipelinePad >> partner: aPad [
	partner := aPad
]

{ #category : 'printing' }
PipelinePad >> printOn: aStream [
	aStream nextPutAll: self fullName
]

{ #category : 'views' }
PipelinePad >> gtSummaryFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Summary';
		priority: 1;
		items: [ self summary ];
		column: 'Property' do: [ :column |
			column
				text: [ :each | each key ];
				fitContent ];
		column: 'Value' text: [ :each | each value displayString ];
		send: [ :each | each value ]
]

{ #category : 'views' }
PipelinePad >> gtCapsFor: aView [
	<gtView>
	link ifNil: [ ^ aView ].
	^ aView text
		title: 'Caps';
		priority: 2;
		text: [ link capsText ]
]

{ #category : 'views' }
PipelinePad >> gtPropertiesFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Properties';
		priority: 3;
		items: [ properties ];
		column: 'Property' do: [ :column |
			column
				text: [ :each | each key ];
				fitContent ];
		column: 'Value' text: [ :each | each value ]
]

{ #category : 'accessing' }
PipelinePad >> summary [
	| rows |
	rows := OrderedCollection new.
	rows
		add: 'Name' -> name;
		add: 'Element' -> element;
		add: 'Direction' -> direction;
		add: 'Kind' -> kind;
		add: 'Presence' -> presence;
		add: 'Activation' -> self activation;
		add: 'Flags' -> self flags;
		add: 'Task' -> self task.
	link ifNotNil: [ rows add: 'Peer' -> self peer; add: 'Link' -> link ].
	partner ifNotNil: [ rows add: self partnerRole -> partner ].
	rows add: 'Address' -> address.
	^ rows
]

{ #category : 'accessing' }
PipelinePad >> activation [
	^ #( 'none' 'push' 'pull' ) at: ('-><' indexOf: (flagText at: 2))
]

{ #category : 'accessing' }
PipelinePad >> flags [
	| letters names |
	letters := self flagLetters.
	names := #( 'blocked' 'flushing' 'blocking' 'eos' ) first: letters size.
	^ ' ' join: ((1 to: letters size) select: [ :each | (letters at: each) isUppercase ] thenCollect: [ :each | names at: each ])
]

{ #category : 'accessing' }
PipelinePad >> flagLetters [
	^ flagText copyFrom: 5 to: (flagText indexOf: $] startingAt: 5) - 1
]

{ #category : 'accessing' }
PipelinePad >> task [
	(flagText endsWith: '[T]') ifTrue: [ ^ 'started' ].
	(flagText endsWith: '[t]') ifTrue: [ ^ 'paused' ].
	^ ''
]

{ #category : 'accessing' }
PipelinePad >> peer [
	link ifNil: [ ^ nil ].
	^ link from == self
		ifTrue: [ link to ]
		ifFalse: [ link from ]
]

{ #category : 'accessing' }
PipelinePad >> partnerRole [
	^ kind = 'proxy'
		ifTrue: [ 'Ghost pad' ]
		ifFalse: [ 'Proxy pad' ]
]

{ #category : 'accessing' }
PipelinePad >> peerText [
	^ self peer
		ifNil: [ '' ]
		ifNotNil: [ :pad | pad fullName ]
]

{ #category : 'accessing' }
PipelinePad >> fullName [
	^ element name , '.' , name
]

{ #category : 'accessing' }
PipelinePad >> address [
	^ address
]

{ #category : 'accessing' }
PipelinePad >> key [
	^ address
]

{ #category : 'accessing' }
PipelinePad >> name [
	^ name
]

{ #category : 'accessing' }
PipelinePad >> direction [
	^ direction
]

{ #category : 'accessing' }
PipelinePad >> kind [
	^ kind
]

{ #category : 'accessing' }
PipelinePad >> presence [
	^ presence
]

{ #category : 'accessing' }
PipelinePad >> flagText [
	^ flagText
]

{ #category : 'accessing' }
PipelinePad >> properties [
	^ properties
]

{ #category : 'accessing' }
PipelinePad >> element [
	^ element
]

{ #category : 'accessing' }
PipelinePad >> link [
	^ link
]

{ #category : 'accessing' }
PipelinePad >> partner [
	^ partner
]

{ #category : 'accessing' }
PipelinePad >> isProxy [
	^ kind = 'proxy'
]

{ #category : 'accessing' }
PipelinePad >> isGhost [
	^ kind = 'ghost'
]

{ #category : 'accessing' }
PipelinePad >> isSource [
	^ direction = 'src'
]

{ #category : 'highlighting' }
PipelinePad >> linkedObjects [
	^ { self } , self farObjects
]

{ #category : 'highlighting' }
PipelinePad >> farObjects [
	| objects |
	link ifNil: [ ^ #() ].
	objects := OrderedCollection with: link with: self peer.
	self peer isOnLeaf ifTrue: [ objects add: self peer element ].
	^ objects asArray
]

{ #category : 'highlighting' }
PipelinePad >> isOnLeaf [
	^ kind = 'plain' and: [ element isBin not ]
]
