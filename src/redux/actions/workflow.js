/* eslint-disable arrow-body-style */
import axiosInstance from '../axios';
import { updateObject } from '../utility';
import * as actionTypes from './actionTypes';

export const getWorkflowsSuccess = (workflows) => updateObject({ type: actionTypes.GET_WORKFLOWS, workflows });
export const loadingStart = () => updateObject({ type: actionTypes.LOADING_START });
export const loadingEnd = () => updateObject({ type: actionTypes.LOADING_END });

export const getWorkflowsStart = () => {
  return async (dispatch) => {
    dispatch(loadingStart());
    await axiosInstance.get('/cockpit/workflows/stats').then((response) => {
      dispatch(getWorkflowsSuccess(response.data.workflows));
    }).catch((err) => {
      console.log(err);
    }).finally(() => {
      dispatch(loadingEnd());
    });
  };
};
