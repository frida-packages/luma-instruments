Class {
	#name : 'PipelineBin',
	#superclass : 'PipelineElement',
	#instVars : [
		'children'
	],
	#category : 'GStreamer'
}

{ #category : 'initialization' }
PipelineBin >> setAddress: anAddress label: aLabel role: aRole in: aBin [
	super setAddress: anAddress label: aLabel role: aRole in: aBin.
	children := OrderedCollection new
]

{ #category : 'building' }
PipelineBin >> addChild: anElement [
	children add: anElement
]

{ #category : 'views' }
PipelineBin >> gtChildrenFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Children';
		priority: 2;
		items: [ children ];
		column: 'Name' text: [ :each | each name ];
		column: 'Type' text: [ :each | each type ];
		column: 'State' text: [ :each | each stateText ];
		column: 'Pads' text: [ :each | each pads size printString ]
]

{ #category : 'accessing' }
PipelineBin >> summary [
	^ super summary , { 'Children' -> children size printString }
]

{ #category : 'accessing' }
PipelineBin >> children [
	^ children
]

{ #category : 'accessing' }
PipelineBin >> isBin [
	^ true
]
