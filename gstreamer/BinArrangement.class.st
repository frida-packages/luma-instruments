Class {
	#name : 'BinArrangement',
	#superclass : 'Object',
	#instVars : [
		'nodes',
		'ranks',
		'successors',
		'predecessors',
		'waypoints',
		'columns'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
BinArrangement class >> of: someChildren flows: someFlows [
	^ self new setChildren: someChildren flows: someFlows
]

{ #category : 'initialization' }
BinArrangement >> setChildren: someChildren flows: someFlows [
	nodes := OrderedCollection withAll: someChildren.
	self rankBy: (someFlows select: [ :each | each first notNil and: [ each second notNil ] ]).
	successors := nodes collect: [ :each | OrderedCollection new ].
	predecessors := nodes collect: [ :each | OrderedCollection new ].
	waypoints := OrderedCollection new.
	someFlows do: [ :each | self thread: each ].
	self gatherColumns.
	self sweep
]

{ #category : 'ranking' }
BinArrangement >> rankBy: someFlows [
	| following waiting ready |
	ranks := OrderedCollection new: nodes size withAll: 0.
	following := nodes collect: [ :each | OrderedCollection new ].
	waiting := nodes collect: [ :each | 0 ].
	someFlows do: [ :each |
		(following at: each first) add: each second.
		waiting at: each second put: (waiting at: each second) + 1 ].
	ready := ((1 to: nodes size) select: [ :each | (waiting at: each) = 0 ]) asOrderedCollection.
	[ ready isEmpty ] whileFalse: [ self settle: ready removeFirst following: following into: ready waiting: waiting ]
]

{ #category : 'ranking' }
BinArrangement >> settle: anIndex following: someSuccessors into: aQueue waiting: someCounts [
	(someSuccessors at: anIndex) do: [ :each |
		ranks at: each put: ((ranks at: each) max: (ranks at: anIndex) + 1).
		someCounts at: each put: (someCounts at: each) - 1.
		(someCounts at: each) = 0 ifTrue: [ aQueue add: each ] ]
]

{ #category : 'threading' }
BinArrangement >> thread: aFlow [
	| previous leaving |
	previous := aFlow first.
	leaving := aFlow third.
	(self rankBefore: aFlow) + 1 to: (self rankAfter: aFlow) - 1 do: [ :rank |
		| waypoint |
		waypoint := self addWaypoint: (LinkWaypoint of: aFlow fifth rank: rank) at: rank.
		previous ifNotNil: [ self join: previous to: waypoint leaving: leaving entering: 1 / 2 ].
		previous := waypoint.
		leaving := 1 / 2 ].
	(previous notNil and: [ aFlow second notNil ]) ifTrue: [ self join: previous to: aFlow second leaving: leaving entering: aFlow fourth ]
]

{ #category : 'threading' }
BinArrangement >> rankBefore: aFlow [
	^ aFlow first
		ifNil: [ -1 ]
		ifNotNil: [ :index | ranks at: index ]
]

{ #category : 'threading' }
BinArrangement >> rankAfter: aFlow [
	^ aFlow second
		ifNil: [ self highestRank + 1 ]
		ifNotNil: [ :index | ranks at: index ]
]

{ #category : 'threading' }
BinArrangement >> highestRank [
	^ (1 to: nodes size - waypoints size) inject: 0 into: [ :highest :each | highest max: (ranks at: each) ]
]

{ #category : 'threading' }
BinArrangement >> addWaypoint: aWaypoint at: aRank [
	nodes add: aWaypoint.
	ranks add: aRank.
	successors add: OrderedCollection new.
	predecessors add: OrderedCollection new.
	waypoints add: aWaypoint.
	^ nodes size
]

{ #category : 'threading' }
BinArrangement >> join: aSource to: aTarget leaving: aLeaving entering: anEntering [
	(successors at: aSource) add: aTarget -> anEntering.
	(predecessors at: aTarget) add: aSource -> aLeaving
]

{ #category : 'ordering' }
BinArrangement >> gatherColumns [
	columns := (0 to: (ranks inject: 0 into: [ :highest :each | highest max: each ])) collect: [ :rank |
		((1 to: nodes size) select: [ :each | (ranks at: each) = rank ]) asOrderedCollection ]
]

{ #category : 'ordering' }
BinArrangement >> sweep [
	4 timesRepeat: [
		2 to: columns size do: [ :each | self order: each by: predecessors ].
		columns size - 1 to: 1 by: -1 do: [ :each | self order: each by: successors ] ]
]

{ #category : 'ordering' }
BinArrangement >> order: aColumnIndex by: someNeighbors [
	| column keys |
	column := columns at: aColumnIndex.
	keys := Dictionary new.
	column doWithIndex: [ :each :position | keys at: each put: (self barycenterOf: each by: someNeighbors ifNone: position) -> position ].
	columns at: aColumnIndex put: (column asSortedCollection: [ :a :b | self key: (keys at: a) precedes: (keys at: b) ]) asOrderedCollection
]

{ #category : 'ordering' }
BinArrangement >> barycenterOf: anIndex by: someNeighbors ifNone: aPosition [
	| neighbors |
	neighbors := someNeighbors at: anIndex.
	neighbors ifEmpty: [ ^ aPosition ].
	^ (neighbors inject: 0 into: [ :sum :each | sum + (self positionOf: each key) + each value ]) / neighbors size
]

{ #category : 'ordering' }
BinArrangement >> positionOf: anIndex [
	^ (columns at: (ranks at: anIndex) + 1) indexOf: anIndex
]

{ #category : 'ordering' }
BinArrangement >> key: aKey precedes: anotherKey [
	aKey key = anotherKey key ifTrue: [ ^ aKey value <= anotherKey value ].
	^ aKey key < anotherKey key
]

{ #category : 'accessing' }
BinArrangement >> columns [
	^ columns collect: [ :each | each collect: [ :index | nodes at: index ] ]
]

{ #category : 'accessing' }
BinArrangement >> waypoints [
	^ waypoints
]
