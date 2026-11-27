Class {
	#name : 'SceneComponent',
	#superclass : 'Object',
	#instVars : [
		'type',
		'owner',
		'fields'
	],
	#category : 'Unity'
}

{ #category : 'instance creation' }
SceneComponent class >> type: aString on: aSceneObject [
	^ self new setType: aString owner: aSceneObject
]

{ #category : 'naming' }
SceneComponent class >> isTransformType: aString [
	^ aString = 'UnityEngine.Transform' or: [ aString = 'UnityEngine.RectTransform' ]
]

{ #category : 'naming' }
SceneComponent class >> shortTypeOf: aString [
	| generic |
	generic := aString indexOf: $<.
	^ generic = 0
		ifTrue: [ aString copyAfterLast: $. ]
		ifFalse: [ ((aString first: generic - 1) copyAfterLast: $.) , (aString allButFirst: generic - 1) ]
]

{ #category : 'initialization' }
SceneComponent >> setType: aString owner: aSceneObject [
	type := aString.
	owner := aSceneObject
]

{ #category : 'accessing' }
SceneComponent >> type [
	^ type
]

{ #category : 'inspecting' }
SceneComponent >> takeFields: someFields [
	fields := someFields asArray
]

{ #category : 'printing' }
SceneComponent >> shortType [
	^ self class shortTypeOf: type
]

{ #category : 'printing' }
SceneComponent >> fieldsText [
	^ fields
		ifNil: [ '…' ]
		ifNotNil: [ fields size printString ]
]

{ #category : 'printing' }
SceneComponent >> printOn: aStream [
	aStream nextPutAll: self shortType; nextPutAll: ' on '; print: owner
]

{ #category : 'views' }
SceneComponent >> gtFieldsFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Fields';
		priority: 1;
		items: [ fields ifNil: [ #() ] ];
		column: 'Field' do: [ :column |
			column
				text: [ :each | each at: 'name' ];
				weight: 2;
				minimumCharacters: 8 ];
		column: 'Value' do: [ :column |
			column
				text: [ :each | each at: 'value' ];
				weight: 3;
				minimumCharacters: 8 ];
		column: 'Type' do: [ :column |
			column
				text: [ :each | each at: 'type' ];
				weight: 2;
				priority: 2 ];
		column: 'Declared by' do: [ :column |
			column
				text: [ :each | each at: 'declaredBy' ];
				weight: 2;
				priority: 3 ]
]
