import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { AbstractControl, FormControl } from '@angular/forms';
import { DynamicFormArrayGroupModel, DynamicFormControlEvent } from '@ng-dynamic-forms/core';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Observable, of as observableOf, Subject, Subscription } from 'rxjs';
import { filter, switchMap } from 'rxjs/operators';
import { AppState } from '../../../../../app.reducer';
import { RelationshipService } from '../../../../../core/data/relationship.service';
import { RemoteData } from '../../../../../core/data/remote-data';
import { Relationship } from '../../../../../core/shared/item-relationships/relationship.model';
import { Item } from '../../../../../core/shared/item.model';
import { ItemMetadataRepresentation } from '../../../../../core/shared/metadata-representation/item/item-metadata-representation.model';
import { MetadataRepresentation } from '../../../../../core/shared/metadata-representation/metadata-representation.model';
import { MetadataValue } from '../../../../../core/shared/metadata.models';
import {
  getAllSucceededRemoteData,
  getRemoteDataPayload,
  getSucceededRemoteData
} from '../../../../../core/shared/operators';
import { hasValue, isNotEmpty } from '../../../../empty.util';
import { ItemSearchResult } from '../../../../object-collection/shared/item-search-result.model';
import { SelectableListService } from '../../../../object-list/selectable-list/selectable-list.service';
import { FormFieldMetadataValueObject } from '../../models/form-field-metadata-value.model';
import { RelationshipOptions } from '../../models/relationship-options.model';
import { DynamicConcatModel } from '../models/ds-dynamic-concat.model';
import { RemoveRelationshipAction, UpdateRelationshipAction } from '../relation-lookup-modal/relationship.actions';
import { SubmissionObject } from '../../../../../core/submission/models/submission-object.model';

// tslint:disable:max-classes-per-file
/**
 * Abstract class that defines objects that can be reordered
 */
export abstract class Reorderable {

  constructor(public oldIndex?: number, public newIndex?: number) {
  }

  /**
   * Return the id for this Reorderable
   */
  abstract getId(): string;

  /**
   * Return the place metadata for this Reorderable
   */
  abstract getPlace(): number;

  /**
   * Update the Reorderable
   */
  abstract update(): Observable<any>;

  /**
   * Returns true if the oldIndex of this Reorderable
   * differs from the newIndex
   */
  get hasMoved(): boolean {
    return this.oldIndex !== this.newIndex
  }
}

/**
 * A Reorderable representation of a FormFieldMetadataValue
 */
export class ReorderableFormFieldMetadataValue extends Reorderable {

  constructor(
    public metadataValue: FormFieldMetadataValueObject,
    public model: DynamicConcatModel,
    public control: FormControl,
    public group: DynamicFormArrayGroupModel,
    oldIndex?: number,
    newIndex?: number
  ) {
    super(oldIndex, newIndex);
    this.metadataValue = metadataValue;
  }

  /**
   * Return the id for this Reorderable
   */
  getId(): string {
    if (hasValue(this.metadataValue.authority)) {
      return this.metadataValue.authority;
    } else {
      // can't use UUIDs, they're generated client side
      return this.metadataValue.value;
    }
  }

  /**
   * Return the place metadata for this Reorderable
   */
  getPlace(): number {
    return this.metadataValue.place;
  }

  /**
   * Update the Reorderable
   */
  update(): Observable<FormFieldMetadataValueObject> {
    this.oldIndex = this.newIndex;
    return observableOf(this.metadataValue);
  }

}

/**
 * Represents a single relationship that can be reordered in a list of multiple relationships
 */
export class ReorderableRelationship extends Reorderable {

  constructor(
    public relationship: Relationship,
    public useLeftItem: boolean,
    protected relationshipService: RelationshipService,
    protected store: Store<AppState>,
    protected submissionID: string,
    oldIndex?: number,
    newIndex?: number) {
    super(oldIndex, newIndex);
    this.relationship = relationship;
    this.useLeftItem = useLeftItem;
  }

  /**
   * Return the id for this Reorderable
   */
  getId(): string {
    return this.relationship.id;
  }

  /**
   * Return the place metadata for this Reorderable
   */
  getPlace(): number {
    if (this.useLeftItem) {
      return this.relationship.rightPlace
    } else {
      return this.relationship.leftPlace
    }
  }

  /**
   * Update the Reorderable
   */
  update(): Observable<RemoteData<Relationship>> {
    this.store.dispatch(new UpdateRelationshipAction(this.relationship, this.submissionID));
    const updatedRelationship$ = this.relationshipService.updatePlace(this).pipe(
      getSucceededRemoteData()
    );

    updatedRelationship$.subscribe(() => {
      this.oldIndex = this.newIndex;

    });

    return updatedRelationship$;
  }
}

/**
 * Represents a single existing relationship value as metadata in submission
 */
@Component({
  selector: 'ds-existing-metadata-list-element',
  templateUrl: './existing-metadata-list-element.component.html',
  styleUrls: ['./existing-metadata-list-element.component.scss']
})
export class ExistingMetadataListElementComponent implements OnInit, OnChanges, OnDestroy {
  @Input() listId: string;
  @Input() submissionItem: Item;
  @Input() reoRel: ReorderableRelationship;
  @Input() metadataFields: string[];
  @Input() relationshipOptions: RelationshipOptions;
  @Input() submissionId: string;
  metadataRepresentation$: BehaviorSubject<MetadataRepresentation> = new BehaviorSubject<MetadataRepresentation>(undefined);
  relatedItem: Item;

  /**
   * List of subscriptions to unsubscribe from
   */
  private subs: Subscription[] = [];

  constructor(
    private selectableListService: SelectableListService,
    private store: Store<AppState>
  ) {
  }

  ngOnInit(): void {
    this.ngOnChanges();
  }

  /**
   * Change callback for the component
   */
  ngOnChanges() {
    if (hasValue(this.reoRel)) {
      const item$ = this.reoRel.useLeftItem ?
        this.reoRel.relationship.leftItem : this.reoRel.relationship.rightItem;
      this.subs.push(item$.pipe(
        getAllSucceededRemoteData(),
        getRemoteDataPayload(),
        filter((item: Item) => hasValue(item) && isNotEmpty(item.uuid))
      ).subscribe((item: Item) => {
        this.relatedItem = item;
        const relationMD: MetadataValue = this.submissionItem.firstMetadata(this.relationshipOptions.metadataField, { value: this.relatedItem.uuid });
        if (hasValue(relationMD)) {
          const metadataRepresentationMD: MetadataValue = this.submissionItem.firstMetadata(this.metadataFields, { authority: relationMD.authority });
          const nextValue = Object.assign(
            new ItemMetadataRepresentation(metadataRepresentationMD),
            this.relatedItem
          );
          this.metadataRepresentation$.next(nextValue);
        }
      }));
    }
  }

  /**
   * Removes the selected relationship from the list
   */
  removeSelection() {
    this.selectableListService.deselectSingle(this.listId, Object.assign(new ItemSearchResult(), { indexableObject: this.relatedItem }));
    this.store.dispatch(new RemoveRelationshipAction(this.submissionItem, this.relatedItem, this.relationshipOptions.relationshipType, this.submissionId))
  }

  /**
   * Unsubscribe from all subscriptions
   */
  ngOnDestroy(): void {
    this.subs
      .filter((sub) => hasValue(sub))
      .forEach((sub) => sub.unsubscribe());
  }

}

// tslint:enable:max-classes-per-file
