import { Component } from 'react';
import PropTypes from 'prop-types';
import { get, set } from 'lodash-es';
import { findDOMNode } from 'react-dom';

export default class SortableGroup extends Component {
  static contextTypes = {
    manager: PropTypes.object.isRequired,
  };

  static propTypes = {
    sortGroup: PropTypes.any,
    collection: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    collectionCount: PropTypes.number,
    defaultNodeHeight: PropTypes.number,
    isDisabledChecker: PropTypes.func,
    onReRenderer: PropTypes.func,
  };

  static defaultProps = {
    collection: 0,
    collectionCount: 0,
    defaultNodeHeight: 75,
    sortGroup: {},
    isDisabledChecker: () => { return true; },
    onReRenderer: () => {},
  };

  state = {
    activeCollection: null,
    startCollection: null,
  }

  componentDidMount() {
    const { collection } = this.props;
    this.setDragGroup(collection);
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.collectionCount !== this.props.collectionCount) {
      this.refreshCollectionCount(nextProps.collectionCount);
    }
  }

  refreshCollectionCount = (count) => {
    set(this.context, ['manager', 'group', this.props.collection, 'sortGroupInfo', 'collectionCount'], count);
  }

  setDragGroup = (collection) => {
    const node = (this.node = findDOMNode(this));
    node.sortGroupInfo = {
      collection,
      sortGroup: this.props.sortGroup,
      collectionCount: this.props.collectionCount,
      reRenderer: this.handleReRenderer,
    };
    this.context.manager.setGroup(collection, node);
    this.ref = { node };
  }

  handleReRenderer = () => {
    const manager = this.context.manager;
    const startManager = get(manager, ['start'], null);
    const startCollection = get(startManager, ['collection'], null);
    const activeManager = get(manager, ['active'], null);
    const activeCollection = get(activeManager, ['collection'], null);
    this.setState({
      activeCollection,
      startCollection,
    });
    this.props.onReRenderer();
  }

  render() {
    let placeholderNode = null;
    const manager = this.context.manager;
    const startManager = get(manager, ['start'], null);
    const startCollection = this.state.startCollection;

    const disabled = manager.getIsGroupDisabled(this.props.collection)
    && this.props.isDisabledChecker(startCollection);

    const activeCollection = this.state.activeCollection;
    if (activeCollection != null && activeCollection === this.props.collection
      && startCollection !== this.props.collection
    ) {
      placeholderNode = get(startManager, ['node'], null);
    }
    const placeholderDimensions = get(startManager, 'dimensions', {
      height: this.props.defaultNodeHeight,
      width: 0,
    });
    return this.props.children({
      placeholderNode,
      placeholderDimensions,
      disabled,
      updateStamp: this.state.updateStamp,
    });
  }
}
