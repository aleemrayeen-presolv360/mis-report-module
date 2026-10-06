/**
 * Conditions a fixed filter can use, per field type.
 * The frontend reads this list from GET /api/mis/config, so the UI and the SQL builder never disagree.
 * The SQL for each operator lives in utils/query-builder.js (buildFilterCondition).
 */

const OPERATORS = {
  text: [
    { key: 'is', label: 'is' },
    { key: 'isnot', label: 'is not' },
    { key: 'contains', label: 'contains' },
    { key: 'empty', label: 'is empty' },
    { key: 'notempty', label: 'is not empty' },
  ],
  enum: [
    { key: 'in', label: 'is any of' },
    { key: 'notin', label: 'is none of' },
    { key: 'empty', label: 'is empty' },
    { key: 'notempty', label: 'is not empty' },
  ],
  number: [
    { key: 'gt', label: 'more than' },
    { key: 'gte', label: 'at least' },
    { key: 'lt', label: 'less than' },
    { key: 'lte', label: 'at most' },
    { key: 'eq', label: 'equals' },
  ],
  date: [
    { key: 'empty', label: 'is empty' },
    { key: 'notempty', label: 'is not empty' },
    { key: 'before', label: 'before' },
    { key: 'after', label: 'after' },
    { key: 'lastn', label: 'in the last N days' },
    { key: 'nextn', label: 'in the next N days' },
  ],
  boolean: [
    { key: 'yes', label: 'is Yes' },
    { key: 'no', label: 'is No' },
  ],
};

// Field type -> which operator list it uses.
const OPERATOR_GROUP_BY_TYPE = {
  text: 'text',
  enum: 'enum',
  number: 'number',
  amount: 'number',
  date: 'date',
  datetime: 'date',
  boolean: 'boolean',
};

// Operators that need no value from the user.
const NO_VALUE_OPERATORS = ['empty', 'notempty', 'yes', 'no'];

function operatorsForType(fieldType) {
  return OPERATORS[OPERATOR_GROUP_BY_TYPE[fieldType]] || [];
}

module.exports = { OPERATORS, OPERATOR_GROUP_BY_TYPE, NO_VALUE_OPERATORS, operatorsForType };
