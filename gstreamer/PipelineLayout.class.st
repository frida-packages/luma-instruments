Class {
	#name : 'PipelineLayout',
	#superclass : 'Object',
	#instVars : [
		'lettering',
		'shape',
		'frames',
		'extents',
		'overhangs',
		'offsets',
		'padOffsets',
		'linksByBin',
		'waypointsByBin',
		'bends',
		'lanes',
		'routes',
		'padKeys',
		'leafKeys',
		'binKeys',
		'bounds'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
PipelineLayout class >> of: aSnapshot measuredBy: aLettering [
	^ self new setSnapshot: aSnapshot lettering: aLettering
]

{ #category : 'initialization' }
PipelineLayout >> setSnapshot: aSnapshot lettering: aLettering [
	lettering := aLettering.
	shape := aSnapshot shape.
	frames := Dictionary new.
	extents := Dictionary new.
	overhangs := Dictionary new.
	offsets := Dictionary new.
	padOffsets := Dictionary new.
	waypointsByBin := Dictionary new.
	bends := Dictionary new.
	lanes := Dictionary new.
	routes := Dictionary new.
	self sortLinksOf: aSnapshot.
	self measure: aSnapshot top.
	self place: aSnapshot top at: 0 @ 0.
	self routeLinksOf: aSnapshot.
	self indexKeysOf: aSnapshot.
	bounds := (frames values inject: frames anyOne into: [ :all :each | all merge: each ]) expandBy: 24
]

{ #category : 'sorting' }
PipelineLayout >> sortLinksOf: aSnapshot [
	linksByBin := Dictionary new.
	aSnapshot links do: [ :each | (linksByBin at: (self containerOf: each from) key ifAbsentPut: [ OrderedCollection new ]) add: each ]
]

{ #category : 'sorting' }
PipelineLayout >> containerOf: aPad [
	aPad isProxy ifTrue: [ ^ aPad element ].
	^ aPad element parent
]

{ #category : 'measuring' }
PipelineLayout >> measure: anElement [
	anElement isBin ifTrue: [ ^ self measureBin: anElement ].
	extents at: anElement key put: (self extentOfElement: anElement).
	overhangs at: anElement key put: 0 @ 0
]

{ #category : 'measuring' }
PipelineLayout >> measureBin: aBin [
	| arrangement columns gaps x contentHeight ghostHeight sinkSide sourceSide width |
	aBin children do: [ :each | self measure: each ].
	arrangement := BinArrangement of: aBin children flows: (self flowsWithin: aBin).
	waypointsByBin at: aBin key put: arrangement waypoints.
	arrangement waypoints do: [ :each | extents at: each key put: 0 @ self waypointHeight ].
	columns := arrangement columns.
	gaps := self gapsWithin: aBin columns: columns.
	sinkSide := self sideOf: (self sinkPadsOf: aBin).
	sourceSide := self sideOf: (self sourcePadsOf: aBin).
	x := self leftOf: sinkSide gap: gaps first.
	contentHeight := (columns inject: 0 into: [ :tallest :each | tallest max: (self heightOfColumn: each) ]) max: (self labelRoomWithin: aBin).
	columns doWithIndex: [ :column :index |
		| columnWidth columnHeight y |
		columnWidth := column inject: 0 into: [ :widest :each | widest max: (extents at: each key) x ].
		columnHeight := self heightOfColumn: column.
		y := self titleHeight + ((contentHeight - columnHeight) / 2).
		column do: [ :each |
			offsets at: each key put: (x + ((columnWidth - (extents at: each key) x) / 2)) @ y.
			lanes at: each key put: x @ (x + columnWidth).
			y := y + (extents at: each key) y + self rowGap ].
		self stretch: (column select: [ :each | arrangement waypoints includes: each ]) from: x across: columnWidth.
		x := x + columnWidth + (gaps at: index + 1) ].
	width := self rightOf: sourceSide after: x gap: gaps last.
	ghostHeight := ((self sinkPadsOf: aBin) size max: (self sourcePadsOf: aBin) size) * (self padHeight + 6).
	overhangs at: aBin key put: (sinkSide first / 2) @ (sourceSide first / 2).
	extents at: aBin key put: (width + (sinkSide first / 2) + (sourceSide first / 2)) @ (self titleHeight + (contentHeight max: ghostHeight) + 14).
	self arrangeGhostsOf: aBin width: width
]

{ #category : 'measuring' }
PipelineLayout >> flowsWithin: aBin [
	| children |
	children := aBin children asArray.
	^ ((linksByBin at: aBin key ifAbsent: [ #() ])
		reject: [ :each | (each from isProxy and: [ each to isProxy ]) or: [ each from element == each to element ] ])
		collect: [ :each | {
			self indexOf: each from among: children.
			self indexOf: each to among: children.
			self fractionOf: each from.
			self fractionOf: each to.
			each } ]
]

{ #category : 'measuring' }
PipelineLayout >> indexOf: aPad among: someChildren [
	aPad isProxy ifTrue: [ ^ nil ].
	^ someChildren indexOf: aPad element
]

{ #category : 'measuring' }
PipelineLayout >> fractionOf: aPad [
	| side |
	side := aPad isSource
		ifTrue: [ self sourcePadsOf: aPad element ]
		ifFalse: [ self sinkPadsOf: aPad element ].
	^ (side indexOf: aPad) / (side size + 1)
]

{ #category : 'measuring' }
PipelineLayout >> sourcePadsOf: anElement [
	^ anElement pads select: [ :each | each isSource ]
]

{ #category : 'measuring' }
PipelineLayout >> sinkPadsOf: anElement [
	^ anElement pads reject: [ :each | each isSource ]
]

{ #category : 'measuring' }
PipelineLayout >> gapsWithin: aBin columns: someColumns [
	| gaps |
	gaps := Array new: someColumns size + 1 withAll: 0.
	(linksByBin at: aBin key ifAbsent: [ #() ]) do: [ :each |
		| slot |
		slot := self slotOf: each from in: someColumns.
		gaps at: slot put: ((gaps at: slot) max: (self labelWidthOf: each) + 26) ].
	^ gaps collect: [ :each | each max: 28 ]
]

{ #category : 'measuring' }
PipelineLayout >> slotOf: aPad in: someColumns [
	aPad isProxy ifTrue: [ ^ 1 ].
	^ (someColumns findFirst: [ :each | each includes: aPad element ]) + 1
]

{ #category : 'measuring' }
PipelineLayout >> labelWidthOf: aLink [
	| lines |
	lines := self wrappedLabelLinesOf: aLink.
	lines ifEmpty: [ ^ 0 ].
	^ (lines allButFirst
		inject: (lettering widthOf: lines first size: self capsTypeSize)
		into: [ :widest :each | widest max: (lettering widthOf: each size: self capsFieldSize) ]) min: self labelLimit
]

{ #category : 'measuring' }
PipelineLayout >> wrappedLabelLinesOf: aLink [
	| lines |
	lines := aLink labelLines.
	lines ifEmpty: [ ^ #() ].
	^ { lines first } , (lines allButFirst flatCollect: [ :each | self wrappedField: each ])
]

{ #category : 'measuring' }
PipelineLayout >> wrappedField: aLine [
	| separator |
	separator := aLine indexOfSubCollection: ': '.
	(aLine size <= self wrapLength or: [ separator = 0 ]) ifTrue: [ ^ { aLine } ].
	^ { aLine first: separator } , ((self packed: (self piecesOf: (aLine allButFirst: separator + 1))) collect: [ :each | '  ' , each ])
]

{ #category : 'measuring' }
PipelineLayout >> piecesOf: aValue [
	| pieces |
	pieces := aValue splitOn: ', '.
	^ (pieces allButLast collect: [ :each | each , ',' ]) , { pieces last }
]

{ #category : 'measuring' }
PipelineLayout >> packed: somePieces [
	| lines current |
	lines := OrderedCollection new.
	current := ''.
	somePieces do: [ :each |
		(current notEmpty and: [ current size + 1 + each size > self wrapLength ]) ifTrue: [
			lines add: current.
			current := '' ].
		current := current isEmpty
			ifTrue: [ each ]
			ifFalse: [ current , ' ' , each ] ].
	^ lines asArray , { current }
]

{ #category : 'measuring' }
PipelineLayout >> sideOf: somePads [
	| proxies |
	proxies := (somePads select: [ :each | each partner notNil ]) collect: [ :each | each partner ].
	somePads ifEmpty: [ ^ #( 0 0 ) ].
	^ { self widestPadOf: somePads. (self widestPadOf: proxies) + 6 }
]

{ #category : 'measuring' }
PipelineLayout >> widestPadOf: somePads [
	^ somePads inject: 0 into: [ :widest :each | widest max: (self padWidthOf: each) ]
]

{ #category : 'measuring' }
PipelineLayout >> padWidthOf: aPad [
	^ ((lettering widthOf: aPad name size: self padNameSize) max: (lettering widthOf: '[>][bfbE][T]' size: self padFlagSize)) + 8
]

{ #category : 'measuring' }
PipelineLayout >> leftOf: aSide gap: aGap [
	aSide first = 0 ifTrue: [ ^ 12 ].
	^ aSide first / 2 + aSide second + aGap
]

{ #category : 'measuring' }
PipelineLayout >> heightOfColumn: aColumn [
	^ (aColumn inject: 0 into: [ :sum :each | sum + (extents at: each key) y ]) + (self rowGap * (aColumn size - 1 max: 0))
]

{ #category : 'measuring' }
PipelineLayout >> labelRoomWithin: aBin [
	^ (linksByBin at: aBin key ifAbsent: [ #() ])
		inject: 0
		into: [ :tallest :each | tallest max: ((self labelHeightOf: each) + self padHeight) * 2 + 8 ]
]

{ #category : 'measuring' }
PipelineLayout >> labelHeightOf: aLink [
	| lines |
	lines := self wrappedLabelLinesOf: aLink.
	lines ifEmpty: [ ^ 0 ].
	^ (lettering lineHeight: self capsTypeSize) + ((lines size - 1) * (lettering lineHeight: self capsFieldSize))
]

{ #category : 'measuring' }
PipelineLayout >> titleHeight [
	^ self headerHeight + 4
]

{ #category : 'measuring' }
PipelineLayout >> headerHeight [
	^ (lettering lineHeight: self typeSize) * 2 + (lettering lineHeight: self nameSize) + 8
]

{ #category : 'measuring' }
PipelineLayout >> stretch: someWaypoints from: anX across: aWidth [
	someWaypoints do: [ :each |
		offsets at: each key put: anX @ (offsets at: each key) y.
		extents at: each key put: aWidth @ self waypointHeight ]
]

{ #category : 'measuring' }
PipelineLayout >> rightOf: aSide after: anX gap: aGap [
	aSide first = 0 ifTrue: [ ^ anX - aGap + 12 ].
	^ anX + aSide second + (aSide first / 2)
]

{ #category : 'measuring' }
PipelineLayout >> arrangeGhostsOf: aBin width: aWidth [
	(self sinkPadsOf: aBin) doWithIndex: [ :each :index | self arrangeGhost: each at: 0 row: index inward: 1 ].
	(self sourcePadsOf: aBin) doWithIndex: [ :each :index | self arrangeGhost: each at: aWidth row: index inward: -1 ]
]

{ #category : 'measuring' }
PipelineLayout >> arrangeGhost: aPad at: anEdge row: aRow inward: aSign [
	| top width |
	top := self titleHeight + ((aRow - 1) * (self padHeight + 6)).
	width := self padWidthOf: aPad.
	padOffsets at: aPad key put: (anEdge - (width / 2)) @ top.
	aPad partner ifNil: [ ^ self ].
	padOffsets at: aPad partner key put: (self proxyLeftOf: aPad partner at: anEdge + (aSign * (width / 2 + 6)) inward: aSign) @ top
]

{ #category : 'measuring' }
PipelineLayout >> proxyLeftOf: aProxy at: anEdge inward: aSign [
	aSign > 0 ifTrue: [ ^ anEdge ].
	^ anEdge - (self padWidthOf: aProxy)
]

{ #category : 'measuring' }
PipelineLayout >> extentOfElement: anElement [
	| sinkWidth sourceWidth rows width |
	sinkWidth := self widestPadOf: (self sinkPadsOf: anElement).
	sourceWidth := self widestPadOf: (self sourcePadsOf: anElement).
	rows := (self sinkPadsOf: anElement) size max: (self sourcePadsOf: anElement) size.
	width := (self headerWidthOf: anElement) max: sinkWidth + sourceWidth + 24.
	^ (width max: 64) @ (self headerHeight + (rows * (self padHeight + self padGap)) + 4)
]

{ #category : 'measuring' }
PipelineLayout >> headerWidthOf: anElement [
	^ {
		lettering widthOf: anElement type size: self typeSize.
		lettering widthOf: anElement name size: self nameSize.
		lettering widthOf: 'void-pending -> playing' size: self typeSize } max + 12
]

{ #category : 'placing' }
PipelineLayout >> place: anElement at: aPoint [
	| box |
	box := (aPoint + ((overhangs at: anElement key) x @ 0)) extent: (extents at: anElement key) - (((overhangs at: anElement key) x + (overhangs at: anElement key) y) @ 0).
	frames at: anElement key put: box.
	anElement isBin
		ifTrue: [ self placeContentsOf: anElement in: box ]
		ifFalse: [ self placePadsOf: anElement in: box ]
]

{ #category : 'placing' }
PipelineLayout >> placeContentsOf: aBin in: aBox [
	aBin children do: [ :each |
		self place: each at: aBox origin + (offsets at: each key).
		lanes at: each key put: (lanes at: each key) + aBox left ].
	(waypointsByBin at: aBin key) do: [ :each |
		(bends at: each link key ifAbsentPut: [ OrderedCollection new ]) add: (aBox origin + (offsets at: each key) extent: (extents at: each key)) ].
	aBin pads do: [ :each | self placePad: each at: aBox origin + (padOffsets at: each key) ].
	(aBin pads select: [ :each | each partner notNil ]) do: [ :each | self placePad: each partner at: aBox origin + (padOffsets at: each partner key) ]
]

{ #category : 'placing' }
PipelineLayout >> placePad: aPad at: aPoint [
	frames at: aPad key put: (aPoint extent: (self padWidthOf: aPad) @ self padHeight)
]

{ #category : 'placing' }
PipelineLayout >> placePadsOf: anElement in: aBox [
	| sinkWidth sourceWidth |
	sinkWidth := self widestPadOf: (self sinkPadsOf: anElement).
	sourceWidth := self widestPadOf: (self sourcePadsOf: anElement).
	(self sinkPadsOf: anElement) doWithIndex: [ :each :index |
		frames at: each key put: ((aBox left + 4) @ (self padTopIn: aBox row: index) extent: sinkWidth @ self padHeight) ].
	(self sourcePadsOf: anElement) doWithIndex: [ :each :index |
		frames at: each key put: ((aBox right - 4 - sourceWidth) @ (self padTopIn: aBox row: index) extent: sourceWidth @ self padHeight) ]
]

{ #category : 'placing' }
PipelineLayout >> padTopIn: aBox row: aRow [
	^ aBox top + self headerHeight + ((aRow - 1) * (self padHeight + self padGap))
]

{ #category : 'routing' }
PipelineLayout >> routeLinksOf: aSnapshot [
	aSnapshot links do: [ :each |
		routes at: each key put: (LinkRoute
			from: (frames at: each from key) rightCenter
			through: (self bendsOf: each)
			to: (frames at: each to key) leftCenter) ].
	linksByBin keysAndValuesDo: [ :key :links | self fitLabelsOf: links within: (frames at: key) ]
]

{ #category : 'routing' }
PipelineLayout >> bendsOf: aLink [
	| start end exit entry |
	start := (frames at: aLink from key) rightCenter.
	end := (frames at: aLink to key) leftCenter - (LinkRoute arrowLength @ 0).
	exit := aLink from isProxy
		ifTrue: [ #() ]
		ifFalse: [ self laneFrom: start x to: (lanes at: aLink from element key) y at: start y ].
	entry := aLink to isProxy
		ifTrue: [ #() ]
		ifFalse: [ self laneFrom: (lanes at: aLink to element key) x to: end x at: end y ].
	^ exit , (bends at: aLink key ifAbsent: [ #() ]) asArray , entry
]

{ #category : 'routing' }
PipelineLayout >> laneFrom: aLeft to: aRight at: aY [
	aRight > (aLeft + 0.5) ifFalse: [ ^ #() ].
	^ { aLeft @ aY corner: aRight @ aY }
]

{ #category : 'routing' }
PipelineLayout >> fitLabelsOf: someLinks within: aBox [
	| bySlot |
	bySlot := Dictionary new.
	someLinks do: [ :each | (bySlot at: (self laneOf: each from) ifAbsentPut: [ OrderedCollection new ]) add: each ].
	bySlot do: [ :each | self fitLabelsInColumn: each within: (aBox top + self titleHeight) to: aBox bottom - 4 ]
]

{ #category : 'routing' }
PipelineLayout >> laneOf: aPad [
	aPad isProxy ifTrue: [ ^ 0 @ 0 ].
	^ lanes at: aPad element key
]

{ #category : 'routing' }
PipelineLayout >> fitLabelsInColumn: someLinks within: aTop to: aBottom [
	| sorted floor |
	sorted := (someLinks asSortedCollection: [ :a :b | (routes at: a key) start y <= (routes at: b key) start y ]) asArray.
	floor := aTop.
	sorted doWithIndex: [ :each :index |
		| route |
		route := routes at: each key.
		route
			labelLines: (self labelLinesOf: each within: (self roomFor: route below: floor before: (sorted at: index + 1 ifAbsent: [ nil ]) bottom: aBottom))
			sizes: self labelSizes
			measuredBy: lettering.
		floor := route rises
			ifTrue: [ route labelBox bottom ]
			ifFalse: [ route start y ] ]
]

{ #category : 'routing' }
PipelineLayout >> roomFor: aRoute below: aFloor before: aNextLink bottom: aBottom [
	| next |
	aRoute rises ifFalse: [ ^ aRoute start y - aFloor ].
	aNextLink ifNil: [ ^ aBottom - aRoute start y ].
	next := routes at: aNextLink key.
	next rises ifTrue: [ ^ next start y - aRoute start y ].
	^ next start y - aRoute start y / 2
]

{ #category : 'routing' }
PipelineLayout >> labelLinesOf: aLink within: aHeight [
	| room shown |
	aLink labelLines ifEmpty: [ ^ #() ].
	room := aHeight - 4 - (lettering lineHeight: self capsTypeSize).
	shown := 1 + ((room / (lettering lineHeight: self capsFieldSize)) floor max: 0).
	^ (self wholeFieldsOf: aLink within: shown) collectWithIndex: [ :each :index |
		lettering truncated: each size: (self labelSizes at: (index min: 2)) width: self labelLimit ]
]

{ #category : 'routing' }
PipelineLayout >> wholeFieldsOf: aLink within: aLineCount [
	| lines kept |
	lines := aLink labelLines.
	kept := OrderedCollection with: lines first.
	lines allButFirst do: [ :each |
		| wrapped |
		wrapped := self wrappedField: each.
		kept size + wrapped size > aLineCount ifTrue: [ ^ kept asArray ].
		kept addAll: wrapped ].
	^ kept asArray
]

{ #category : 'indexing' }
PipelineLayout >> indexKeysOf: aSnapshot [
	padKeys := aSnapshot pads collect: [ :each | each key ].
	leafKeys := (aSnapshot elements reject: [ :each | each isBin ]) collect: [ :each | each key ].
	binKeys := ((aSnapshot elements select: [ :each | each isBin ]) asSortedCollection: [ :a :b | a depth >= b depth ]) collect: [ :each | each key ]
]

{ #category : 'picking' }
PipelineLayout >> keyAt: aPoint within: aDistance [
	padKeys do: [ :each | ((frames at: each) containsPoint: aPoint) ifTrue: [ ^ each ] ].
	leafKeys do: [ :each | ((frames at: each) containsPoint: aPoint) ifTrue: [ ^ each ] ].
	routes keysAndValuesDo: [ :key :route | (route passesNear: aPoint within: aDistance) ifTrue: [ ^ key ] ].
	binKeys do: [ :each | ((frames at: each) containsPoint: aPoint) ifTrue: [ ^ each ] ].
	^ nil
]

{ #category : 'lettering' }
PipelineLayout >> headerOf: anElement [
	| box left top |
	box := frames at: anElement key.
	left := box left + 6.
	top := box top + 4.
	^ {
		{ anElement type. self typeSize. left @ top. #mutedText }.
		{ anElement name. self nameSize. left @ (top + (lettering lineHeight: self typeSize)). #text }.
		{ self stateLineOf: anElement. self typeSize. left @ (top + (lettering lineHeight: self typeSize) + (lettering lineHeight: self nameSize)). #mutedText } }
]

{ #category : 'lettering' }
PipelineLayout >> stateLineOf: anElement [
	anElement pending = 'void-pending' ifTrue: [ ^ anElement state ].
	^ anElement state , ' -> ' , anElement pending
]

{ #category : 'lettering' }
PipelineLayout >> linesOfPad: aPad [
	| box |
	box := frames at: aPad key.
	^ {
		{ aPad name. self padNameSize. (box left + 4) @ (box top + 2). #text }.
		{ aPad flagText. self padFlagSize. (box left + 4) @ (box top + 2 + (lettering lineHeight: self padNameSize)). #mutedText } }
]

{ #category : 'accessing' }
PipelineLayout >> frameOf: anObject [
	^ frames at: anObject key
]

{ #category : 'accessing' }
PipelineLayout >> routeOf: aLink [
	^ routes at: aLink key
]

{ #category : 'accessing' }
PipelineLayout >> bounds [
	^ bounds
]

{ #category : 'accessing' }
PipelineLayout >> shape [
	^ shape
]

{ #category : 'metrics' }
PipelineLayout >> typeSize [
	^ 7
]

{ #category : 'metrics' }
PipelineLayout >> nameSize [
	^ 10
]

{ #category : 'metrics' }
PipelineLayout >> padNameSize [
	^ 7.5
]

{ #category : 'metrics' }
PipelineLayout >> padFlagSize [
	^ 6
]

{ #category : 'metrics' }
PipelineLayout >> capsTypeSize [
	^ 7
]

{ #category : 'metrics' }
PipelineLayout >> capsFieldSize [
	^ 6
]

{ #category : 'metrics' }
PipelineLayout >> labelSizes [
	^ { self capsTypeSize. self capsFieldSize }
]

{ #category : 'metrics' }
PipelineLayout >> wrapLength [
	^ 20
]

{ #category : 'metrics' }
PipelineLayout >> labelLimit [
	^ 190
]

{ #category : 'metrics' }
PipelineLayout >> padHeight [
	^ (lettering lineHeight: self padNameSize) + (lettering lineHeight: self padFlagSize) + 4
]

{ #category : 'metrics' }
PipelineLayout >> waypointHeight [
	^ 4
]

{ #category : 'metrics' }
PipelineLayout >> padGap [
	^ 4
]

{ #category : 'metrics' }
PipelineLayout >> rowGap [
	^ 16
]
