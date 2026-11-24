Class {
	#name : 'PipelineReader',
	#superclass : 'Object',
	#instVars : [
		'elements',
		'pads',
		'padsById',
		'links',
		'edges'
	],
	#category : 'GStreamer'
}

{ #category : 'reading' }
PipelineReader class >> read: aGraph dot: aString address: anAddress [
	^ self new read: aGraph dot: aString address: anAddress
]

{ #category : 'reading' }
PipelineReader >> read: aGraph dot: aString address: anAddress [
	| top |
	elements := OrderedCollection new.
	pads := OrderedCollection new.
	padsById := Dictionary new.
	links := OrderedCollection new.
	edges := OrderedCollection new.
	top := PipelineRoot address: anAddress label: (self labelOf: aGraph) role: 'bin' in: nil.
	elements add: top.
	self readContentsOf: aGraph for: top.
	edges do: [ :each | self connect: each ].
	top descendants: elements allButFirst links: links dot: aString.
	^ PipelineSnapshot top: top elements: elements pads: pads links: links
]

{ #category : 'reading' }
PipelineReader >> labelOf: aGraph [
	^ PipelineLabel of: (aGraph attributes at: 'label')
]

{ #category : 'reading' }
PipelineReader >> readContentsOf: aCluster for: anElement [
	edges addAll: aCluster edges.
	aCluster subgraphs do: [ :each | self readCluster: each in: anElement ]
]

{ #category : 'reading' }
PipelineReader >> readCluster: aCluster in: anElement [
	(self isPadCluster: aCluster) ifTrue: [ ^ self readPadsOf: aCluster for: anElement ].
	self readElement: aCluster in: anElement
]

{ #category : 'reading' }
PipelineReader >> isPadCluster: aCluster [
	^ (aCluster id endsWith: '_sink') or: [ aCluster id endsWith: '_src' ]
]

{ #category : 'reading' }
PipelineReader >> readPadsOf: aCluster for: anElement [
	| side |
	side := (aCluster id endsWith: '_src')
		ifTrue: [ 'src' ]
		ifFalse: [ 'sink' ].
	aCluster nodes do: [ :each | self readPad: each on: side of: anElement ].
	edges addAll: aCluster edges
]

{ #category : 'reading' }
PipelineReader >> readPad: aNode on: aSide of: anElement [
	| kind pad |
	kind := self kindOf: aNode.
	pad := PipelinePad
		address: (self addressIn: aNode id)
		label: (PipelineLabel of: (aNode attributes at: 'label'))
		direction: (self directionOf: kind on: aSide)
		kind: kind
		presence: (self presenceOf: aNode)
		of: anElement.
	padsById at: aNode id put: pad.
	pads add: pad.
	kind = 'proxy' ifFalse: [ anElement addPad: pad ]
]

{ #category : 'reading' }
PipelineReader >> kindOf: aNode [
	aNode id first = $_ ifTrue: [ ^ 'proxy' ].
	(#( '#ffdddd' '#ddddff' '#ffffff' ) includes: (aNode attributes at: 'fillcolor')) ifTrue: [ ^ 'ghost' ].
	^ 'plain'
]

{ #category : 'reading' }
PipelineReader >> addressIn: anId [
	^ anId copyAfterLast: $_
]

{ #category : 'reading' }
PipelineReader >> directionOf: aKind on: aSide [
	aKind = 'proxy' ifFalse: [ ^ aSide ].
	^ aSide = 'src'
		ifTrue: [ 'sink' ]
		ifFalse: [ 'src' ]
]

{ #category : 'reading' }
PipelineReader >> presenceOf: aNode [
	| style |
	style := aNode attributes at: 'style'.
	style = 'filled,dotted' ifTrue: [ ^ 'sometimes' ].
	style = 'filled,dashed' ifTrue: [ ^ 'request' ].
	^ 'always'
]

{ #category : 'reading' }
PipelineReader >> readElement: aCluster in: aBin [
	| element |
	element := (self classFor: aCluster)
		address: (self addressIn: aCluster id)
		label: (self labelOf: aCluster)
		role: (self roleOf: aCluster)
		in: aBin.
	elements add: element.
	aBin addChild: element.
	self readContentsOf: aCluster for: element
]

{ #category : 'reading' }
PipelineReader >> classFor: aCluster [
	(aCluster subgraphs anySatisfy: [ :each | (self isPadCluster: each) not ]) ifTrue: [ ^ PipelineBin ].
	^ PipelineElement
]

{ #category : 'reading' }
PipelineReader >> roleOf: aCluster [
	^ (Dictionary newFrom: { '#ffaaaa' -> 'source'. '#aaaaff' -> 'sink'. '#aaffaa' -> 'filter'. '#ffffff' -> 'bin' })
		at: (aCluster attributes at: 'fillcolor')
]

{ #category : 'connecting' }
PipelineReader >> connect: anEdge [
	anEdge style = 'invis' ifTrue: [ ^ self ].
	anEdge style = 'dashed' ifTrue: [ ^ self pair: anEdge ].
	links add: (self linkOf: anEdge)
]

{ #category : 'connecting' }
PipelineReader >> pair: anEdge [
	| tail head |
	tail := padsById at: anEdge tail.
	head := padsById at: anEdge head.
	tail partner: head.
	head partner: tail
]

{ #category : 'connecting' }
PipelineReader >> linkOf: anEdge [
	^ PipelineLink
		from: (padsById at: anEdge tail)
		to: (padsById at: anEdge head)
		caps: (self capsIn: 'label' of: anEdge)
		sourceCaps: (self capsIn: 'taillabel' of: anEdge)
		sinkCaps: (self capsIn: 'headlabel' of: anEdge)
]

{ #category : 'connecting' }
PipelineReader >> capsIn: aKey of: anEdge [
	^ (PipelineLabel of: (anEdge attributes at: aKey ifAbsent: [ '' ])) capsLines
]
