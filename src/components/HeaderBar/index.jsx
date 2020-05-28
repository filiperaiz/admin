import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useHistory } from 'react-router-dom';

import * as actions from '../../redux/actions';
import iconUtil from '../../utils/iconUtil';
import Logo from '../Logo/index';


const HeaderBar = () => {
  const dispatch = useDispatch();
  const history = useHistory();
  const token = useSelector((state) => state.auth.token);
  const logoutUser = () => {
    dispatch(actions.logout());
    history.push('/login');
  };
  return (
    <header className="header-bar">
      <Logo className="logo" height="3.5" />
      {token && iconUtil('LogoutHeader', logoutUser)}
    </header>
  );
};

export default HeaderBar;
