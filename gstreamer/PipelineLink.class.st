Class {
	#name : 'PipelineLink',
	#superclass : 'Object',
	#instVars : [
		'from',
		'to',
		'caps',
		'sourceCaps',
		'sinkCaps'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
PipelineLink class >> from: aSourcePad to: aSinkPad caps: someLines sourceCaps: someSourceLines sinkCaps: someSinkLines [
	^ self new setFrom: aSourcePad to: aSinkPad caps: someLines sourceCaps: someSourceLines sinkCaps: someSinkLines
]

{ #category : 'initialization' }
PipelineLink >> setFrom: aSourcePad to: aSinkPad caps: someLines sourceCaps: someSourceLines sinkCaps: someSinkLines [
	from := aSourcePad.
	to := aSinkPad.
	caps := someLines.
	sourceCaps := someSourceLines.
	sinkCaps := someSinkLines.
	from link: self.
	to link: self
]

{ #category : 'printing' }
PipelineLink >> printOn: aStream [
	aStream nextPutAll: from fullName; nextPutAll: ' → '; nextPutAll: to fullName
]

{ #category : 'views' }
PipelineLink >> gtCapsFor: aView [
	<gtView>
	^ aView text
		title: 'Caps';
		priority: 1;
		text: [ self capsText ]
]

{ #category : 'views' }
PipelineLink >> gtSummaryFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Summary';
		priority: 2;
		items: [ self summary ];
		column: 'Property' text: [ :each | each key ];
		column: 'Value' text: [ :each | each value displayString ];
		send: [ :each | each value ]
]

{ #category : 'accessing' }
PipelineLink >> capsText [
	caps ifNotEmpty: [ ^ String lf join: caps ].
	sinkCaps ifEmpty: [ ^ 'This graph was taken without caps.' ].
	^ String lf join: { 'Source pad offers:' } , sourceCaps , { ''. 'Sink pad accepts:' } , sinkCaps
]

{ #category : 'accessing' }
PipelineLink >> summary [
	^ {
		'From' -> from.
		'To' -> to.
		'From element' -> from element.
		'To element' -> to element.
		'Media type' -> self mediaType }
]

{ #category : 'accessing' }
PipelineLink >> mediaType [
	^ self labelLines
		ifEmpty: [ '' ]
		ifNotEmpty: [ :lines | lines first ]
]

{ #category : 'accessing' }
PipelineLink >> labelLines [
	caps ifNotEmpty: [ ^ caps ].
	sinkCaps ifEmpty: [ ^ #() ].
	^ { sourceCaps first , ' / ' , sinkCaps first }
]

{ #category : 'accessing' }
PipelineLink >> from [
	^ from
]

{ #category : 'accessing' }
PipelineLink >> to [
	^ to
]

{ #category : 'accessing' }
PipelineLink >> key [
	^ from address , '>' , to address
]

{ #category : 'highlighting' }
PipelineLink >> linkedObjects [
	^ { self. from. to } , (({ from. to } select: [ :each | each isOnLeaf ]) collect: [ :each | each element ])
]
