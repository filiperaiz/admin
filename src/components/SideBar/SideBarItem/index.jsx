import React from 'react';

import PropTypes from 'prop-types';

import IconUtil from '../../../utils/iconUtil';

const SideBarItem = ({
  icon, name,
}) => (
  <div className="sidebar-item">
    <div>
      {IconUtil(icon)}
      <p>{name}</p>
    </div>
  </div>
);

SideBarItem.propTypes = {
  icon: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
};

export default SideBarItem;