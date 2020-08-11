/* eslint-disable no-plusplus */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable no-return-assign */
/* eslint-disable class-methods-use-this */
/* eslint-disable camelcase */
/**
 * @file xmlConverter.js
 *
 * @brief Loads a json blueprint and build a bpmn xml representation
 *
 * @author Felipe Gomes de Melo <felipe.melo@fdte.io>
 * @author Gabriel Lopes Rodriges <gabriel.rodrigues@fdte.io>
 *
 * Based in the paper Kitzmann, Ingo, et al. 2009
 * "A simple algorithm for automatic layout of bpmn processes."
 *
 * To convert a json blueprint, look at build_graph() and to_xml()
 */

import BpmnModdle from 'bpmn-moddle';
// import { catch } from 'fetch-mock';
// import { object } from 'prop-types';

import Grid from './xmlGrid';

class xmlConverter {
  constructor() {
    this.moddle = new BpmnModdle();
  }

  static validate(spec) {
    if (!spec.nodes || !spec.lanes) {
      return false;
    }
    return true;
  }

  static std_lane_id(lane_id) {
    return `Lane_${lane_id}`;
  }

  static std_node_id(node_id) {
    return ['Node', node_id].join('_');
  }

  static std_node_name(node_name) {
    return node_name.split(' ').join('_');
  }

  static std_flow_id(node_id, node_next) {
    return ['Flow', node_id, node_next].join('_');
  }

  parse_node(node, incoming_flows) {
    const params = {
      id: xmlConverter.std_node_id(node.id),
      name: xmlConverter.std_node_name(node.name),
    };

    if (node.type === 'Start') {
      params.outgoing = this.parse_sequence_flow(node);
      return this.moddle.create('bpmn:StartEvent', params);
    } if (node.type === 'Finish') {
      params.incoming = incoming_flows[xmlConverter.std_node_id(node.id)];
      return this.moddle.create('bpmn:EndEvent', params);
    } if (node.type === 'Flow') {
      params.incoming = incoming_flows[xmlConverter.std_node_id(node.id)];
      params.outgoing = this.parse_sequence_flow(node);
      return this.moddle.create('bpmn:ExclusiveGateway', params);
    }

    params.outgoing = this.parse_sequence_flow(node);
    params.incoming = incoming_flows[xmlConverter.std_node_id(node.id)];

    switch (node.type) {
      case 'SystemTask':
        return this.moddle.create('bpmn:ServiceTask', params);

      case 'UserTask':
        return this.moddle.create('bpmn:UserTask', params);

      case 'ScriptTask':
        return this.moddle.create('bpmn:ScriptTask', params);

      default:
        return this.moddle.create('bpmn:Task', params);
    }
  }

  parse_sequence_flow(node) {
    if (node.type !== 'Flow' && node.type !== 'Finish') {
      // If node is not a flow node,
      // it has only one outgoing sequence
      const id = xmlConverter.std_flow_id(node.id, node.next);
      const sourceRef = { id: xmlConverter.std_node_id(node.id) };
      const targetRef = { id: xmlConverter.std_node_id(node.next) };

      return [this.moddle.create('bpmn:SequenceFlow', { id, sourceRef, targetRef })];
    } if (node.type === 'Flow') {
      const sourceRef = { id: xmlConverter.std_node_id(node.id) };
      const outgoing = [];
      for (const value in node.next) {
        const nextId = node.next[value];
        const id = xmlConverter.std_flow_id(node.id, nextId);
        if (outgoing.findIndex((el) => el.id === id) === -1) {
          const targetRef = { id: xmlConverter.std_node_id(nextId) };
          outgoing.push(this.moddle.create('bpmn:SequenceFlow', { id, sourceRef, targetRef }));
        }
      }
      return outgoing;
    }
    return [];
  }

  build_graph(blueprint_spec) {
    if (!xmlConverter.validate(blueprint_spec)) {
      throw new Error('Invalid spec: no nodes or no lanes.');
    }

    this.xml_participant = this.moddle.create('bpmn:Participant', {
      id: 'Global_Actor',
      processRef: { id: 'Global_Process' },
    });

    this.xml_collab = this.moddle.create('bpmn:Collaboration', {
      id: 'Global_Colab',
      participants: [
        this.xml_participant,
      ],
    });

    const { incoming_flows, xml_sequences } = this.build_sequence_flows(blueprint_spec.nodes);

    this.xml_sequences = xml_sequences;
    this.xml_nodes = this.build_nodes(blueprint_spec.nodes, incoming_flows);

    this.xml_laneset = this.build_laneset(blueprint_spec.nodes, blueprint_spec.lanes);

    const flowElements = this.xml_nodes.concat(this.xml_sequences);
    this.xml_process = this.moddle.create('bpmn:Process', {
      // id: "Process_01zyiho",
      id: 'Global_Process',
      laneSets: [this.xml_laneset],
      isExecutable: true,
      flowElements,
    });

    const id2index = this.build_nodes_id2index(blueprint_spec.nodes);
    const { id2rank, y_depth } = this.discover_node_ranks(blueprint_spec, id2index);

    this.xml_diagrams = this.build_diagram(blueprint_spec, this.xml_sequences, id2rank, y_depth);

    const rootElements = [this.xml_process, this.xml_collab, this.xml_diagrams];
    this.root = this.moddle.create('bpmn:Definitions',
      {
        rootElements,
        // diagrams: this.xml_diagrams
      });
  }

  build_nodes(nodes, incoming_flows) {
    return nodes.map((node) => this.parse_node(node, incoming_flows));
  }

  build_sequence_flows(nodes) {
    let xml_sequences = [];
    nodes.forEach((node) => {
      const parsed = this.parse_sequence_flow(node);
      xml_sequences = [...xml_sequences, ...parsed];
    });

    const incoming_flows = {};

    xml_sequences.forEach((seq) => {
      if (typeof incoming_flows[seq.targetRef.id] === 'undefined') {
        incoming_flows[seq.targetRef.id] = [];
      }
      incoming_flows[seq.targetRef.id].push(seq);
    });

    return { incoming_flows, xml_sequences };
  }

  parse_lane(nodes, lane) {
    const id = xmlConverter.std_lane_id(lane.id);
    const flowNodeRef = [];
    nodes.forEach((node) => {
      if (node.lane_id === lane.id) {
        flowNodeRef.push({ id: xmlConverter.std_node_id(node.id) });
      }
    });
    return this.moddle.create('bpmn:Lane', { id, flowNodeRef });
  }

  build_laneset(nodes, lanes) {
    const xml_lanes = lanes.map((lane) => this.parse_lane(nodes, lane));
    return this.moddle.create('bpmn:LaneSet', { id: 'Global_LaneSet', lanes: xml_lanes });
  }

  build_diagram(spec, xml_sequences, id2rank, y_depth) {
    const { nodes } = spec;
    const default_height = 80;
    const default_width = 100;
    const default_x_margin = 15;
    const default_y_margin = 40;
    const default_x_spacing = default_width + 2 * default_x_margin;
    const default_y_spacing = default_height + 2 * default_y_margin;
    const default_padding = 50;

    const max_x = 1 + Object.keys(id2rank).reduce((max, id) => Math.max(max, id2rank[id][0]), 0);

    const default_total_width = max_x * default_x_spacing;

    const start_stop_dim = 36;
    const flow_dim = 50;

    const lane_heigth = y_depth.map((el) => el * default_y_spacing);

    const lane_heigth_con = [0];
    for (let i = 1; i < lane_heigth.length; i++) {
      lane_heigth_con.push(lane_heigth_con[i - 1] + lane_heigth[i - 1]);
    }

    const lanes_ids = spec.lanes.map((lane) => lane.id).sort((a, b) => a - b);

    const default_style = (node) => this.moddle.create('dc:Bounds', {
      x: default_padding + default_x_spacing * id2rank[xmlConverter.std_node_id(node.id)][0],
      y: default_padding + default_y_spacing * id2rank[xmlConverter.std_node_id(node.id)][1] + lane_heigth_con[lanes_ids.findIndex((el) => el === node.lane_id)],
      width: default_width,
      height: default_height,
    });

    const bounds_style = {
      Start: (node) => this.moddle.create('dc:Bounds', {
        x: default_padding + default_x_spacing * id2rank[xmlConverter.std_node_id(node.id)][0] + default_width - start_stop_dim,
        y: default_padding + default_y_spacing * id2rank[xmlConverter.std_node_id(node.id)][1] + (default_height - start_stop_dim) / 2 + lane_heigth_con[lanes_ids.findIndex((el) => el === node.lane_id)],
        width: start_stop_dim,
        height: start_stop_dim,
      }),
      Finish: (node) => this.moddle.create('dc:Bounds', {
        x: default_padding + default_x_spacing * id2rank[xmlConverter.std_node_id(node.id)][0],
        y: default_padding + default_y_spacing * id2rank[xmlConverter.std_node_id(node.id)][1] + (default_height - start_stop_dim) / 2 + lane_heigth_con[lanes_ids.findIndex((el) => el === node.lane_id)],
        width: start_stop_dim,
        height: start_stop_dim,
      }),
      Flow: (node) => this.moddle.create('dc:Bounds', {
        x: default_padding + default_x_spacing * id2rank[xmlConverter.std_node_id(node.id)][0] + (default_width - flow_dim) / 2,
        y: default_padding + default_y_spacing * id2rank[xmlConverter.std_node_id(node.id)][1] + (default_height - flow_dim) / 2 + lane_heigth_con[lanes_ids.findIndex((el) => el === node.lane_id)],
        width: flow_dim,
        height: flow_dim,
      }),
      SystemTask: default_style,
      UserTask: default_style,
      ScriptTask: default_style,
    };

    const bounds_array = {};
    nodes.forEach((node) => {
      try {
        bounds_array[xmlConverter.std_node_id(node.id)] = bounds_style[node.type](node);
      } catch (e) {
        console.log('Error in node ', node.id);
        console.log(e);
      }
    });

    const diagram_nodes = nodes.map((node) => {
      const bounds = bounds_array[xmlConverter.std_node_id(node.id)];

      return this.moddle.create('bpmndi:BPMNShape', {
        id: `${xmlConverter.std_node_id(node.id)}_di`,
        bpmnElement: { id: xmlConverter.std_node_id(node.id) },
        bounds,
      });
    });

    const generate_waypoints = (sourceRef, targetRef) => {
      const points_list = [];
      if (sourceRef.x < targetRef.x) {
        points_list.push([sourceRef.x + sourceRef.width,
          sourceRef.y + sourceRef.height / 2]);

        points_list.push([sourceRef.x + sourceRef.width + default_x_margin / 1.5,
          sourceRef.y + sourceRef.height / 2]);

        points_list.push([sourceRef.x + sourceRef.width + default_x_margin / 1.5,
          targetRef.y + targetRef.height / 2]);

        points_list.push([targetRef.x,
          targetRef.y + targetRef.height / 2]);
      } else if (sourceRef.y < targetRef.y) {
        points_list.push([sourceRef.x + sourceRef.width / 2,
          sourceRef.y + sourceRef.height]);

        points_list.push([sourceRef.x + sourceRef.width / 2,
          sourceRef.y + sourceRef.height + default_y_margin / 1.5]);

        points_list.push([targetRef.x + targetRef.width / 2,
          sourceRef.y + sourceRef.height + default_y_margin / 1.5]);

        points_list.push([targetRef.x + targetRef.width / 2,
          targetRef.y]);
      } else if (sourceRef.y > targetRef.y) {
        points_list.push([sourceRef.x + sourceRef.width / 2,
          sourceRef.y + sourceRef.height]);

        points_list.push([sourceRef.x + sourceRef.width / 2,
          sourceRef.y + sourceRef.height + default_y_margin / 2]);

        points_list.push([targetRef.x + targetRef.width / 2,
          sourceRef.y + sourceRef.height + default_y_margin / 2]);

        points_list.push([targetRef.x + targetRef.width / 2,
          targetRef.y + targetRef.height]);
      } else {
        points_list.push([sourceRef.x + sourceRef.width,
          sourceRef.y + sourceRef.height / 2]);

        points_list.push([targetRef.x,
          targetRef.y + targetRef.height / 2]);
      }
      return points_list.map((el) => this.moddle.create('dc:Point', { x: el[0], y: el[1] }));
    };

    const diagram_edges = xml_sequences.map((seq) => {
      let waypoint = [];
      try {
        waypoint = generate_waypoints(bounds_array[seq.sourceRef.id], bounds_array[seq.targetRef.id]);
      } catch (e) {
        console.log('Error parsing edge ', seq);
        console.log(e);
      }
      return this.moddle.create('bpmndi:BPMNEdge', {
        id: `${seq.id}_di`,
        bpmnElement: { id: seq.id },
        waypoint,
      });
    });

    const planeElement = diagram_nodes.concat(diagram_edges);

    const total_heigth = lane_heigth.reduce((retval, el) => retval + el, 0);
    const bounds2 = this.moddle.create('dc:Bounds', {
      x: default_padding,
      y: default_padding - default_y_margin,
      width: default_total_width,
      height: total_heigth,
    });

    lanes_ids.forEach((lane_id, index) => {
      const bounds = this.moddle.create('dc:Bounds', {
        x: default_padding + 30,
        y: default_padding - default_y_margin + lane_heigth_con[index],
        width: default_total_width - 30,
        height: lane_heigth[index],
      });
      planeElement.push(this.moddle.create('bpmndi:BPMNShape', {
        id: `${xmlConverter.std_lane_id(lane_id)}_di`,
        bpmnElement: { id: xmlConverter.std_lane_id(lane_id) },
        bounds,
      }));
    });

    planeElement.push(this.moddle.create('bpmndi:BPMNShape', {
      id: 'Global_Actor_di',
      bpmnElement: { id: 'Global_Actor' },
      bounds: bounds2,
    }));

    const plane = this.moddle.create('bpmndi:BPMNPlane', {
      id: 'Global_Plane',
      bpmnElement: { id: 'Global_Colab' },
      planeElement,
    });

    return this.moddle.create('bpmndi:BPMNDiagram', {
      id: 'Global_Diagram',
      plane,
    });
  }

  build_nodes_id2index(nodes) {
    const id2index = {};
    nodes.forEach((value, index) => {
      id2index[value.id] = index;
    });
    return id2index;
  }

  discover_node_ranks(spec, id2index) {
    const { nodes } = spec;
    const { lanes } = spec;
    const lanes_ids = lanes.map((lane) => lane.id);

    const grids = {};
    lanes_ids.forEach((id) => grids[id] = new Grid());

    const start_nodes = nodes.filter((node) => node.type === 'Start');
    const fifo = [];

    fifo.unshift(start_nodes.shift());

    grids[nodes[0].lane_id].add_element(xmlConverter.std_node_id(nodes[0].id), [0, 0]);

    while (fifo.length !== 0) {
      const curr_node = fifo.pop();
      const list_childs = [];

      switch (typeof curr_node.next) {
        case 'string':
          list_childs.push(curr_node.next);
          break;

        case 'object':
          if (curr_node.next) {
            Object.keys(curr_node.next).forEach((key) => {
              const next_node = curr_node.next[key];
              if (!list_childs.includes(next_node)) {
                list_childs.push(next_node);
              }
            });
          }
          break;

        case 'undefined':
          break;

        default:
          console.log('xml_converter.discover_node_ranks() -> Unsupported type!', typeof curr_node.next);
          break;
      }

      const curr_pos = grids[curr_node.lane_id].get_node_pos(xmlConverter.std_node_id(curr_node.id));
      list_childs.forEach((child_id, index) => {
        const child_node = nodes[id2index[child_id]];
        if (!grids[child_node.lane_id].seen_nodes().includes(xmlConverter.std_node_id(child_id))) {
          if (index > 0) {
            grids[child_node.lane_id].add_row_after(index - 1);
          }

          const child_pos = [...curr_pos];
          child_pos[0] += 1;
          child_pos[1] += index;

          grids[child_node.lane_id].add_element(xmlConverter.std_node_id(child_id), child_pos);

          fifo.unshift(nodes[id2index[child_id]]);
        }
      });
    }

    while (start_nodes.length !== 0) {
      let curr_node = start_nodes.shift();
      const stack = [];
      stack.push(curr_node);
      // Stop if we find a finish node or an already seen node
      while (typeof curr_node !== 'undefined'
        && !grids[curr_node.lane_id].seen_nodes().includes(xmlConverter.std_node_id(curr_node.id))) {
        if (typeof curr_node.next === 'object') {
          throw Error('Unsupported multiple starts and flow node yet!');
        }
        stack.push(curr_node);
        curr_node = id2index[curr_node.next];
      }

      const base_rank = !grids[curr_node.lane_id].get_node_pos(xmlConverter.std_node_id(curr_node.id));
      if (base_rank[1] === 0) {
        grids[curr_node.lane_id].add_row_before(base_rank[1]);
      } else {
        grids[curr_node.lane_id].add_row_after(base_rank[1]);
      }

      while (stack.length !== 0) {
        curr_node = stack.pop();
        grids[curr_node.lane_id].add_element(xmlConverter.std_node_id(curr_node.id), base_rank);
        base_rank[0]--;
        if (base_rank[0] < 0) {
          grids[curr_node.lane_id].add_column_before(0);
          base_rank[0] = 0;
        }
      }
    }

    const id2rank = {};
    const y_depth = [];
    Object.keys(grids).forEach((key) => {
      let max_y = 0;
      grids[key].seen_nodes().forEach((node_id) => {
        grids[key].simplify();
        id2rank[node_id] = grids[key].get_node_pos(node_id);
        max_y = Math.max(max_y, grids[key].get_size()[1]);
      });
      y_depth.push(max_y + 1);
    });

    return { id2rank, y_depth };
  }

  async to_xml() {
    const { xml } = await this.moddle.toXML(this.root);
    return xml;
  }
}

export default xmlConverter;