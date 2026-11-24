Class {
	#name : 'LinkWaypoint',
	#superclass : 'Object',
	#instVars : [
		'link',
		'rank'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
LinkWaypoint class >> of: aLink rank: aRank [
	^ self new setLink: aLink rank: aRank
]

{ #category : 'initialization' }
LinkWaypoint >> setLink: aLink rank: aRank [
	link := aLink.
	rank := aRank
]

{ #category : 'accessing' }
LinkWaypoint >> link [
	^ link
]

{ #category : 'accessing' }
LinkWaypoint >> key [
	^ link key , '@' , rank printString
]
