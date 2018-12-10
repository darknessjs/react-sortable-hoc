import React, {Component} from 'react';
import PropTypes from 'prop-types';
import {findDOMNode} from 'react-dom';
import invariant from 'invariant';

import Manager from '../Manager';
import {
  closest,
  events,
  vendorPrefix,
  limit,
  getEdgeOffset,
  getElementMargin,
  getLockPixelOffset,
  getPosition,
  isTouchEvent,
  provideDisplayName,
  omit,
} from '../utils';

// Export Higher Order Sortable Container Component
export default function sortableContainer(WrappedComponent, config = {withRef: false}) {
  return class extends Component {
    constructor(props) {
      super(props);
      this.manager = new Manager();
      this.events = {
        start: this.handleStart,
        move: this.handleMove,
        end: this.handleEnd,
      };

      invariant(
        !(props.distance && props.pressDelay),
        'Attempted to set both `pressDelay` and `distance` on SortableContainer, you may only use one or the other, not both at the same time.'
      );

      this.state = {};
    }

    static displayName = provideDisplayName('sortableList', WrappedComponent);

    static defaultProps = {
      axis: () => {
        return {
          axis: 'y',
          lockAxis: null,
        }
      },
      transitionDuration: 300,
      pressDelay: 0,
      pressThreshold: 5,
      distance: 0,
      hideSortableGhost: true,
      shouldCancelStart: function(e) {
        // Cancel sorting if the event target is an `input`, `textarea`, `select` or `option`
        const disabledElements = ['input', 'textarea', 'select', 'option', 'button'];

        if (disabledElements.indexOf(e.target.tagName.toLowerCase()) !== -1) {
          return true; // Return true to cancel sorting
        }
      },
      lockToContainerEdges: false,
      lockOffset: '50%',
      getHelperDimensions: ({node}) => ({
        width: node.offsetWidth,
        height: node.offsetHeight,
      }),
    };

    static propTypes = {
      axis: PropTypes.func,
      distance: PropTypes.number,
      lockAxis: PropTypes.string,
      helperClass: PropTypes.string,
      transitionDuration: PropTypes.number,
      onSortStart: PropTypes.func,
      onSortMove: PropTypes.func,
      onSortOver: PropTypes.func,
      onSortEnd: PropTypes.func,
      shouldCancelStart: PropTypes.func,
      pressDelay: PropTypes.number,
      useDragHandle: PropTypes.bool,
      hideSortableGhost: PropTypes.bool,
      lockToContainerEdges: PropTypes.bool,
      lockOffset: PropTypes.oneOfType([
        PropTypes.number,
        PropTypes.string,
        PropTypes.arrayOf(
          PropTypes.oneOfType([PropTypes.number, PropTypes.string])
        ),
      ]),
      getContainer: PropTypes.func,
      getHelperDimensions: PropTypes.func,
    };

    static childContextTypes = {
      manager: PropTypes.object.isRequired,
    };

    getChildContext() {
      return {
        manager: this.manager,
      };
    }

    componentDidMount() {

      /*
       *  Set our own default rather than using defaultProps because Jest
       *  snapshots will serialize window, causing a RangeError
       *  https://github.com/clauderic/react-sortable-hoc/issues/249
       */

      const container = this.getContainer();

      Promise.resolve(container).then((containerNode) => {
        this.container = containerNode;
        this.document = this.container.ownerDocument || document;
        const contentWindow = this.document.defaultView;
        this.contentWindow = typeof contentWindow === 'function'
          ? contentWindow()
          : contentWindow;

        for (const key in this.events) {
          if (this.events.hasOwnProperty(key)) {
            events[key].forEach(eventName =>
              this.container.addEventListener(eventName, this.events[key], false)
            );
          }
        }
      });
    }

    componentWillUnmount() {
      if (this.container) {
        for (const key in this.events) {
          if (this.events.hasOwnProperty(key)) {
            events[key].forEach(eventName =>
              this.container.removeEventListener(eventName, this.events[key])
            );
          }
        }
      }
    }

    checkSortableInfo = el => el.sortableInfo != null;
    checkSortableHandle = el => el.sortableHandle != null;
    checkSortableGroup = el => el.sortGroupInfo != null;


    handleStart = event => {
      const {distance, shouldCancelStart, useDragHandle} = this.props;

      if (event.button === 2 || shouldCancelStart(event)) {
        return false;
      }

      this._touched = true;
      this._pos = getPosition(event);

      const node = closest(event.target, this.checkSortableInfo);
      const groupNode = closest(event.target, this.checkSortableGroup);

      if (
        node &&
        node.sortableInfo &&
        this.nodeIsChild(node) &&
        !this.state.sorting
      ) {
        const {index, collection} = node.sortableInfo;
        const dimensions = this.props.getHelperDimensions({ index, collection, node });
        this.manager.active = {index, collection, node, groupNode};
        this.manager.start = {index, collection, node, dimensions };
        this.manager.refreshAllGroup();
        if (
          useDragHandle && !closest(event.target, this.checkSortableHandle)
        )
          return;

        /*
				 * Fixes a bug in Firefox where the :active state of anchor tags
				 * prevent subsequent 'mousemove' events from being fired
				 * (see https://github.com/clauderic/react-sortable-hoc/issues/118)
				 */
        if (!isTouchEvent(event) && event.target.tagName.toLowerCase() === 'a') {
          event.preventDefault();
        }

        if (!distance) {
          if (this.props.pressDelay === 0) {
            this.handlePress(event);
          } else {
            this.pressTimer = setTimeout(
              () => this.handlePress(event),
              this.props.pressDelay
            );
          }
        }
      }
    };

    nodeIsChild = node => {
      return node.sortableInfo.manager === this.manager;
    };

    clearNodeTransform = (nodes) => {
      if (!nodes) return;
      for (let i = 0, len = nodes.length; i < len; i += 1) {
        const node = nodes[i];
        const el = node.node;

        // Clear the cached offsetTop / offsetLeft value
        node.edgeOffset = null;

        // Remove the transforms / transitions
        el.style[`${vendorPrefix}Transform`] = '';
        el.style[`${vendorPrefix}TransitionDuration`] = '';
      }
    }
    handleMove = event => {
      const {distance, pressThreshold} = this.props;

      const sortableGroup = closest(event.target, this.checkSortableGroup);
      if (sortableGroup != null &&
        this.manager.active != null &&
        sortableGroup.sortGroupInfo.sortGroup[this.manager.start.collection] &&
        sortableGroup.sortGroupInfo.collection !== this.manager.active.collection) {
        const newCollection = sortableGroup.sortGroupInfo.collection;
        const oldCollection = this.manager.active.collection;
        const oldNodes = this.manager.refs[oldCollection];
        this.clearNodeTransform(oldNodes);
        let nextIndex = this.manager.start.index;
        if (newCollection !== this.manager.start.collection) {
          nextIndex = sortableGroup.sortGroupInfo.collectionCount;
        }
        this.offsetEdge.top -= this.lastScrollTop;
        this.offsetEdge.left -= this.lastScrollLeft;
        this.changeTranslate(sortableGroup);
        this.initScroll(sortableGroup);
        this.offsetEdge.top += this.scrollContainer.scrollTop;
        this.offsetEdge.left += this.scrollContainer.scrollLeft;

        this.manager.active = {
          index: nextIndex,
          collection: newCollection,
          node: this.manager.start.node,
          groupNode: sortableGroup,
        };
        this.manager.group[oldCollection].sortGroupInfo.reRenderer();
        this.manager.group[newCollection].sortGroupInfo.reRenderer();
        this.index = nextIndex;
        this.newIndex = null;
        this.handleInitNewCollectionStatus();
      }

      if (!this.state.sorting && this._touched) {
        const position = getPosition(event);
        const delta = this._delta = {
          x: this._pos.x - position.x,
          y: this._pos.y - position.y,
        };
        const combinedDelta = Math.abs(delta.x) + Math.abs(delta.y);

        if (!distance && (!pressThreshold || pressThreshold && combinedDelta >= pressThreshold)) {
          clearTimeout(this.cancelTimer);
          this.cancelTimer = setTimeout(this.cancel, 0);
        } else if (distance && combinedDelta >= distance && this.manager.isActive()) {
          this.handlePress(event);
        }
      }
    };

    handleEnd = () => {
      this._touched = false;
      this.cancel();
    };

    cancel = () => {
      const {distance} = this.props;
      const {sorting} = this.state;

      if (!sorting) {
        if (!distance) {
          clearTimeout(this.pressTimer);
        }
        this.manager.active = null;
      }
    };

    lastScrollTop = 0;
    lastScrollLeft = 0;
    initTranslate = (node, container, isOutContainer = false) => {
      const containerBoundingRect = container.getBoundingClientRect();
      const nodeBoundingRect = node.getBoundingClientRect();
      const minTranslate = {};
      const maxTranslate = {};
      let axis = this.axis;
      if (isOutContainer) {
        axis = this.containerAxis;
      }
      if (axis.x) {
        minTranslate.x = containerBoundingRect.left -
          nodeBoundingRect.left -
          this.width / 2;
        maxTranslate.x = containerBoundingRect.left + containerBoundingRect.width -
          nodeBoundingRect.left -
          this.width / 2;
      }
      if (axis.y) {
        minTranslate.y = containerBoundingRect.top -
          nodeBoundingRect.top -
          this.height / 2;
        maxTranslate.y = containerBoundingRect.top + containerBoundingRect.height -
          nodeBoundingRect.top -
          this.height / 2;
      }
      if (isOutContainer) {
        this.outContainer = {};
        this.outContainer.minTranslate = minTranslate;
        this.outContainer.maxTranslate = maxTranslate;
      } else {
        this.scrollContainer = container;
        this.lastScrollTop = this.scrollContainer.scrollTop;
        this.lastScrollLeft = this.scrollContainer.lastScrollLeft;
        this.minTranslate = minTranslate;
        this.maxTranslate = maxTranslate;
        this.boundingClientRect = nodeBoundingRect;
        this.containerBoundingRect = containerBoundingRect;
        this.initTranslate(node, this.container, true)
      }
    }

    changeTranslate = (container) => {
      this.scrollContainer = container;
      const containerBoundingRect = container.getBoundingClientRect();
      if (this.axis.x) {
        const oldTranslateMinx = this.minTranslate.x;
        const oldContainerWidth = this.containerBoundingRect.width;
        const oldContainerLeft = this.containerBoundingRect.left;
        const newContainerWidth = containerBoundingRect.width;
        const newContainerLeft = containerBoundingRect.left;
        const oldTranslateMaxx = this.maxTranslate.x;
        this.minTranslate.x = oldTranslateMinx - (newContainerLeft - oldContainerLeft);
        this.maxTranslate.x = oldTranslateMaxx + (
          newContainerWidth + newContainerLeft - oldContainerWidth - oldContainerLeft
        )
      }
      if (this.axis.y) {
        const oldTranslateMiny = this.minTranslate.y;
        const oldContainerHeight = this.containerBoundingRect.height;
        const oldContainerTop = this.containerBoundingRect.top;
        const newContainerHeight = containerBoundingRect.height;
        const newContainerTop = containerBoundingRect.top;

        const oldTranslateMaxy = this.maxTranslate.y;

        this.minTranslate.y = oldTranslateMiny - (newContainerTop - oldContainerTop);
        this.maxTranslate.y = oldTranslateMaxy + (
          newContainerHeight + newContainerTop - oldContainerHeight - oldContainerTop
        )
      }

      this.containerBoundingRect = containerBoundingRect;

      this.lastScrollTop = this.scrollContainer.scrollTop;
      this.lastScrollLeft = this.scrollContainer.lastScrollLeft;
    }




    initScroll = (container) => {
      this.initialScroll = {
        top: container.scrollTop,
        left: container.scrollLeft,
      };
    }
    handlePress = event => {
      const active = this.manager.getActive();

      if (active) {
        const {
          getHelperDimensions,
          helperClass,
          hideSortableGhost,
          onSortStart,
        } = this.props;
        const {node} = active;
        // this.sortableGhost = node;
        const {index, collection} = node.sortableInfo;
        const margin = getElementMargin(node);
        const groupNode = closest(node, this.checkSortableGroup);
        const container = groupNode || this.container;


        const dimensions = getHelperDimensions({index, node, collection});
        this.width = dimensions.width;
        this.height = dimensions.height;

        const axis = this.props.axis(collection).axis;
        this.axis = {
          x: axis.indexOf('x') >= 0,
          y: axis.indexOf('y') >= 0,
        };
        const containerAxis = this.props.axis().axis;
        this.containerAxis = {
          x: containerAxis.indexOf('x') >= 0,
          y: containerAxis.indexOf('y') >= 0,
        };

        this.initTranslate(node, container);

        this.lastTransform = {
          x: 0,
          y: 0,
        }

        this.node = node;
        this.margin = margin;
        this.marginOffset = {
          x: this.margin.left + this.margin.right,
          y: Math.max(this.margin.top, this.margin.bottom),
        };

        this.index = index;
        this.newIndex = index;

        this.offsetEdge = getEdgeOffset(node, this.container);
        this.initialOffset = getPosition(event);
        this.initScroll(container);

        this.initialWindowScroll = {
          top: window.pageYOffset,
          left: window.pageXOffset,
        };

        const fields = node.querySelectorAll('input, textarea, select');
        const clonedNode = node.cloneNode(true);
        const clonedFields = [
          ...clonedNode.querySelectorAll('input, textarea, select'),
        ]; // Convert NodeList to Array

        clonedFields.forEach((field, index) => {
          if (field.type !== 'file' && fields[index]) {
            field.value = fields[index].value;
          }
        });

        this.helper = this.document.body.appendChild(clonedNode);

        this.helper.style.position = 'fixed';
        this.helper.style.top = `${this.boundingClientRect.top - margin.top}px`;
        this.helper.style.left = `${this.boundingClientRect.left - margin.left}px`;
        this.helper.style.width = `${this.width}px`;
        this.helper.style.height = `${this.height}px`;
        this.helper.style.boxSizing = 'border-box';
        this.helper.style.pointerEvents = 'none';

        // if (hideSortableGhost) {
        //   this.sortableGhost = node;
        //   node.style.visibility = 'hidden';
        //   node.style.opacity = 0;
        // }



        if (helperClass) {
          this.helper.classList.add(...helperClass.split(' '));
        }

        this.listenerNode = event.touches ? node : this.contentWindow;
        events.move.forEach(eventName =>
          this.listenerNode.addEventListener(
            eventName,
            this.handleSortMove,
            false
          ));
        events.end.forEach(eventName =>
          this.listenerNode.addEventListener(
            eventName,
            this.handleSortEnd,
            false
          ));

        this.setState({
          sorting: true,
          sortingIndex: index,
        });

        if (onSortStart) {
          onSortStart({node, index, collection}, event);
        }
      }
    };

    handleSortMove = event => {
      const {onSortMove} = this.props;
      event.preventDefault(); // Prevent scrolling on mobile

      this.updatePosition(event);
      this.animateNodes();
      this.autoscroll(event);

      if (onSortMove) {
        onSortMove(event);
      }
    };

    handleInitNewCollectionStatus = () => {
      clearInterval(this.autoscrollInterval);
      this.autoscrollInterval = null;
      this.isAutoScrolling = false;
    }

    handleSortEnd = event => {
      const {hideSortableGhost, onSortEnd} = this.props;
      const {collection} = this.manager.active;
      const oldCollection = this.manager.start.collection;
      const oldIndex = this.manager.start.index;

      const startNode = this.manager.start.node;
      startNode.style.visibility = '';
      startNode.style.opacity = '';

      // Remove the event listeners if the node is still in the DOM
      if (this.listenerNode) {
        events.move.forEach(eventName =>
          this.listenerNode.removeEventListener(
            eventName,
            this.handleSortMove
          ));
        events.end.forEach(eventName =>
          this.listenerNode.removeEventListener(eventName, this.handleSortEnd));
      }

      // Remove the helper from the DOM
      this.helper.parentNode.removeChild(this.helper);

      if (hideSortableGhost && this.sortableGhost) {
        this.sortableGhost.style.visibility = '';
        this.sortableGhost.style.opacity = '';
      }

      const nodes = this.manager.refs[collection];
      this.clearNodeTransform(nodes);
      const oldNodes = this.manager.refs[oldCollection];
      oldNodes.forEach((node) => {
        node.node.style.visibility = '';
        node.node.style.opacity = '';
      })
      // this.clearNodeTransform(oldNodes);
      // if (oldNodes[oldIndex] && oldNodes[oldIndex].node) {
      //   oldNodes[oldIndex].node.style.visibility = '';
      //   oldNodes[oldIndex].node.style.opacity = '';
      // }
      this.handleInitNewCollectionStatus();

      // Update state
      this.manager.active = null;
      this.manager.start = null;

      this.setState({
        sorting: false,
        sortingIndex: null,
      });

      this.manager.refreshAllGroup();

      if (typeof onSortEnd === 'function') {
        onSortEnd(
          {
            oldIndex: oldIndex,
            newIndex: this.newIndex,
            oldCollection,
            newCollection: collection,
          },
          event
        );
      }

      this._touched = false;
    };

    getLockPixelOffsets() {
      const {width, height} = this;
      const {lockOffset} = this.props;
      const offsets = Array.isArray(lockOffset)
        ? lockOffset
        : [lockOffset, lockOffset];

      invariant(
        offsets.length === 2,
        'lockOffset prop of SortableContainer should be a single ' +
          'value or an array of exactly two values. Given %s',
        lockOffset
      );

      const [minLockOffset, maxLockOffset] = offsets;

      return [
        getLockPixelOffset({lockOffset: minLockOffset, width, height}),
        getLockPixelOffset({lockOffset: maxLockOffset, width, height}),
      ];
    }

    updatePosition(event) {
      const {lockToContainerEdges} = this.props;
      const lockAxis = this.props.axis(this.manager.start.collection).lockAxis;
      const offset = getPosition(event);
      const translate = {
        x: offset.x - this.initialOffset.x,
        y: offset.y - this.initialOffset.y,
      };

      // Adjust for window scroll
      translate.y -= (window.pageYOffset - this.initialWindowScroll.top);
      translate.x -= (window.pageXOffset - this.initialWindowScroll.left);

      this.translate = translate;

      if (lockToContainerEdges) {
        const [minLockOffset, maxLockOffset] = this.getLockPixelOffsets();
        const minOffset = {
          x: this.width / 2 - minLockOffset.x,
          y: this.height / 2 - minLockOffset.y,
        };
        const maxOffset = {
          x: this.width / 2 - maxLockOffset.x,
          y: this.height / 2 - maxLockOffset.y,
        };

        translate.x = limit(
          this.minTranslate.x + minOffset.x,
          this.maxTranslate.x - maxOffset.x,
          translate.x
        );
        translate.y = limit(
          this.minTranslate.y + minOffset.y,
          this.maxTranslate.y - maxOffset.y,
          translate.y
        );
      }

      if (lockAxis === 'x') {
        translate.y = 0;
      } else if (lockAxis === 'y') {
        translate.x = 0;
      }

      this.helper.style[
        `${vendorPrefix}Transform`
      ] = `translate3d(${translate.x}px,${translate.y}px, 0)`;
    }

    animateNodes() {
      const {transitionDuration, hideSortableGhost, onSortOver} = this.props;
      const nodes = this.manager.getOrderedRefs();
      const containerScrollDelta = {
        left: this.scrollContainer.scrollLeft - this.initialScroll.left,
        top: this.scrollContainer.scrollTop - this.initialScroll.top,
      };
      const sortingOffset = {
        left: this.offsetEdge.left + this.translate.x + containerScrollDelta.left,
        top: this.offsetEdge.top + this.translate.y + containerScrollDelta.top,
      };
      const windowScrollDelta = {
        top: (window.pageYOffset - this.initialWindowScroll.top),
        left: (window.pageXOffset - this.initialWindowScroll.left),
      };
      const prevIndex = this.newIndex;
      this.newIndex = null;
      this.lastTransform = {
        x: 0,
        y: 0,
      }

      for (let i = 0, len = nodes.length; i < len; i++) {
        const {node} = nodes[i];
        const index = node.sortableInfo.index;
        const width = node.offsetWidth;
        const height = node.offsetHeight;
        const offset = {
          width: this.width > width ? width / 2 : this.width / 2,
          height: this.height > height ? height / 2 : this.height / 2,
        };

        const translate = {
          x: 0,
          y: 0,
        };
        let {edgeOffset} = nodes[i];

        // If we haven't cached the node's offsetTop / offsetLeft value
        if (!edgeOffset) {
          nodes[i].edgeOffset = (edgeOffset = getEdgeOffset(node, this.container));
        }

        // Get a reference to the next and previous node
        const nextNode = i < nodes.length - 1 && nodes[i + 1];
        const prevNode = i > 0 && nodes[i - 1];

        // Also cache the next node's edge offset if needed.
        // We need this for calculating the animation in a grid setup
        if (nextNode && !nextNode.edgeOffset) {
          nextNode.edgeOffset = getEdgeOffset(nextNode.node, this.container);
        }

        // If the node is the one we're currently animating, skip it
        const thisIndex = this.manager.active.index;
        if (index === thisIndex) {
          this.sortableGhost = node;
          if (hideSortableGhost) {
            /*
						 * With windowing libraries such as `react-virtualized`, the sortableGhost
						 * node may change while scrolling down and then back up (or vice-versa),
						 * so we need to update the reference to the new node just to be safe.
						 */
            node.style.visibility = 'hidden';
            node.style.opacity = 0;
          }
          continue;
        }

        if (transitionDuration) {
          node.style[
            `${vendorPrefix}TransitionDuration`
          ] = `${transitionDuration}ms`;
        }

        if (this.axis.x) {
          if (this.axis.y) {
            // Calculations for a grid setup
            if (
              index < thisIndex &&
              (
                ((sortingOffset.left + windowScrollDelta.left) - offset.width <= edgeOffset.left &&
                (sortingOffset.top + windowScrollDelta.top) <= edgeOffset.top + offset.height) ||
                (sortingOffset.top + windowScrollDelta.top) + offset.height <= edgeOffset.top
              )
            ) {
              // If the current node is to the left on the same row, or above the node that's being dragged
              // then move it to the right
              translate.x = this.width + this.marginOffset.x;
              if (
                edgeOffset.left + translate.x >
                this.containerBoundingRect.width - offset.width
              ) {
                // If it moves passed the right bounds, then animate it to the first position of the next row.
                // We just use the offset of the next node to calculate where to move, because that node's original position
                // is exactly where we want to go
                translate.x = nextNode.edgeOffset.left - edgeOffset.left;
                translate.y = nextNode.edgeOffset.top - edgeOffset.top;
              }
              if (this.newIndex === null) {
                this.newIndex = index;
              }
            } else if (
              index > thisIndex &&
              (
                ((sortingOffset.left + windowScrollDelta.left) + offset.width >= edgeOffset.left &&
                (sortingOffset.top + windowScrollDelta.top) + offset.height >= edgeOffset.top) ||
                (sortingOffset.top + windowScrollDelta.top) + offset.height >= edgeOffset.top + height
              )
            ) {
              // If the current node is to the right on the same row, or below the node that's being dragged
              // then move it to the left
              translate.x = -(this.width + this.marginOffset.x);
              if (
                edgeOffset.left + translate.x <
                this.containerBoundingRect.left + offset.width
              ) {
                // If it moves passed the left bounds, then animate it to the last position of the previous row.
                // We just use the offset of the previous node to calculate where to move, because that node's original position
                // is exactly where we want to go
                translate.x = prevNode.edgeOffset.left - edgeOffset.left;
                translate.y = prevNode.edgeOffset.top - edgeOffset.top;
              }
              this.newIndex = index;
            }
          } else {
            if (
              index > thisIndex &&
              (sortingOffset.left + windowScrollDelta.left) + offset.width >= edgeOffset.left
            ) {
              translate.x = -(this.width + this.marginOffset.x);
              this.newIndex = index;
            } else if (
              index < thisIndex &&
              (sortingOffset.left + windowScrollDelta.left) <= edgeOffset.left + offset.width
            ) {
              translate.x = this.width + this.marginOffset.x;
              if (this.newIndex == null) {
                this.newIndex = index;
              }
            }
          }
        } else if (this.axis.y) {
          if (
            index > thisIndex &&
            (sortingOffset.top + windowScrollDelta.top) + offset.height >= edgeOffset.top
          ) {
            translate.y = -(this.height + this.marginOffset.y);
            this.newIndex = index;
          } else if (
            index < thisIndex &&
            (sortingOffset.top + windowScrollDelta.top) <= edgeOffset.top + offset.height
          ) {
            translate.y = this.height + this.marginOffset.y;
            if (this.newIndex == null) {
              this.newIndex = index;
            }
          }
        }
        // const nodeStyle = this.props.getHelperDimensions({ node });
        // if (translate.x > 0) {
        //   this.lastTransform.x -= nodeStyle.width;
        // }
        // if (translate.y > 0) {
        //   this.lastTransform.y -= nodeStyle.height;
        // }
        // if (translate.x < 0) {
        //   this.lastTransform.x += nodeStyle.width;
        // }
        // if (translate.y < 0) {
        //   this.lastTransform.y += nodeStyle.height;
        // }
        node.style[`${vendorPrefix}Transform`] = `translate3d(${translate.x}px,${translate.y}px,0)`;
      }
      // this.sortableGhost.style[`${vendorPrefix}Transform`] = `translate3d(${this.lastTransform.x}px,${this.lastTransform.y}px,0)`;

      if (this.newIndex == null) {
        this.newIndex = this.index;
      }

      if (onSortOver && this.newIndex !== prevIndex) {
        onSortOver({
          newIndex: this.newIndex,
          oldIndex: prevIndex,
          index: this.index,
          oldCollection: this.manager.start.collection,
          collection: this.manager.active.collection,
        });
      }
    }

    autoscroll = (
      event,
      scrollContainer = this.scrollContainer,
      maxTranslate = this.maxTranslate,
      minTranslate = this.minTranslate,
      isOutContainer = false,
    ) => {
      const translate = this.translate;
      const direction = {
        x: 0,
        y: 0,
      };
      const speed = {
        x: 1,
        y: 1,
      };
      const acceleration = {
        x: 10,
        y: 10,
      };

      if (translate.y >= maxTranslate.y - this.height / 2) {
        direction.y = 1; // Scroll Down
        speed.y = acceleration.y * Math.abs((maxTranslate.y - this.height / 2 - translate.y) / this.height);
      } else if (translate.x >= maxTranslate.x - this.width / 2) {
        direction.x = 1; // Scroll Right
        speed.x = acceleration.x * Math.abs((maxTranslate.x - this.width / 2 - translate.x) / this.width);
      } else if (translate.y <= minTranslate.y + this.height / 2) {
        direction.y = -1; // Scroll Up
        speed.y = acceleration.y * Math.abs((translate.y - this.height / 2 - minTranslate.y) / this.height);
      } else if (translate.x <= minTranslate.x + this.width / 2) {
        direction.x = -1; // Scroll Left
        speed.x = acceleration.x * Math.abs((translate.x - this.width / 2 - minTranslate.x) / this.width);
      }

      if (this.autoscrollInterval) {
        clearInterval(this.autoscrollInterval);
        this.autoscrollInterval = null;
        this.isAutoScrolling = false;
      }

      if (direction.x !== 0 || direction.y !== 0) {
        this.autoscrollInterval = setInterval(
          () => {
            this.isAutoScrolling = true;
            const offset = {
              top: 1 * speed.y * direction.y,
              left: 1 * speed.x * direction.x,
            };
            // const scrollContainer = this.manager.active.groupNode || this.scrollContainer;
            scrollContainer.scrollLeft += offset.left;
            scrollContainer.scrollTop += offset.top;
            this.translate.y += offset.top;
            this.translate.x += offset.left;
            this.animateNodes();
          },
          5
        );
      }
      // console.log('direction', direction.x, direction.y, !isOutContainer);
      if (direction.x === 0 && direction.y === 0 && !isOutContainer) {
        this.autoscroll(
          event,
          this.container,
          this.outContainer.maxTranslate,
          this.outContainer.minTranslate,
          true
        )
      }
    };

    getWrappedInstance() {
      invariant(
        config.withRef,
        'To access the wrapped instance, you need to pass in {withRef: true} as the second argument of the SortableContainer() call'
      );

      return this.refs.wrappedInstance;
    }

    getContainer() {
      const {getContainer} = this.props;

      if (typeof getContainer !== 'function') {
        return findDOMNode(this);
      }

      return getContainer(config.withRef ? this.getWrappedInstance() : undefined);
    }

    render() {
      const ref = config.withRef ? 'wrappedInstance' : null;

      return (
        <WrappedComponent
          ref={ref}
          {...omit(
            this.props,
            'distance',
            'helperClass',
            'hideSortableGhost',
            'transitionDuration',
            'useDragHandle',
            'pressDelay',
            'pressThreshold',
            'shouldCancelStart',
            'onSortStart',
            'onSortMove',
            'onSortEnd',
            'axis',
            'lockAxis',
            'lockOffset',
            'lockToContainerEdges',
            'getContainer',
            'getHelperDimensions'
          )}
        />
      );
    }
  };
}

