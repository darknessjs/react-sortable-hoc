import { get } from 'lodash-es';
export default class Manager {
  refs = {};
  group = {};

  add(collection, ref, index) {
    if (!this.refs[collection]) {
      this.refs[collection] = [];
    }
    if (this.start != null && this.start.index === index) {
      this.start.node = ref.node;
    }

    this.refs[collection].push(ref);
  }

  remove(collection, ref) {
    const index = this.getIndex(collection, ref);

    if (index !== -1) {
      this.refs[collection].splice(index, 1);
    }
  }

  setGroup = (group, node) => {
    this.group[group] = node;
  }


  refreshAllGroup = () => {
    const groupKeys = Object.keys(this.group);
    groupKeys.forEach((groupKey) => {
      this.group[groupKey].sortGroupInfo.reRenderer
      && this.group[groupKey].sortGroupInfo.reRenderer();
    });
  }

  getIsGroupDisabled = (collection) => {
    const startManager = get(this, ['start'], null);
    const startCollection = get(startManager, ['collection'], null);
    const sortGroup = get(this, ['group', collection, 'sortGroupInfo', 'sortGroup'], {});
    if (startCollection != null
      && startCollection !== collection
      && !sortGroup[startCollection]
    ) {
      return true;
    }
    return false;
  }

  isActive() {
    return this.active;
  }

  getActive() {
    return this.refs[this.active.collection].find(
      // eslint-disable-next-line eqeqeq
      ({node}) => node.sortableInfo.index == this.active.index
    );
  }

  getIndex(collection, ref) {
    return this.refs[collection].indexOf(ref);
  }

  getOrderedRefs(collection = this.active.collection) {
    const orederedRefs = get(this.refs, [collection], []);
    return orederedRefs.sort(sortByIndex);
  }
}

function sortByIndex(
  {node: {sortableInfo: {index: index1}}},
  {node: {sortableInfo: {index: index2}}}
) {
  return (index1 - index2);
}
