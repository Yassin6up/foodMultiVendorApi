
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const cors = require('cors');
const http = require('http');
const { calculateDistance } = require("./utils/calculateDistance"); // Assuming you have this utility function
const app = express();

const server = http.createServer(app); // Create HTTP server from Express app

const { Server } = require('socket.io');

const port = 3100

const db = mysql.createConnection({
  host: '5.9.215.4',
  user: 'fastvgu_yassine',
  password: 'yassine6up',
  database: 'fastvgu_fast_path'
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL: ' + err.stack);
    return;
  }
  console.log('Connected to MySQL as id ' + db.threadId);
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({
  origin: '*', // Allow all origins, or specify your frontend URL here
}));

const io = new Server(server, {
  transports: ['websocket', 'polling'], // Ensure both transports are allowed
});


const StoreSocket = io.of('/store')



const riderSocket = io.of('/rider');


StoreSocket.on('connection', (socket) => {
  console.log('A client connected to StoreSocket');

  // Emit riders' locations to the client
const sendRidersLocations = () => {
  const query = `
    SELECT id, latitude, longitude, car_type , socket_id 
    FROM riders
    WHERE socket_id != "" 
    AND latitude != '' 
    AND longitude != ''
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching riders locations:', err);
      return;
    }

    if (results.length > 0) {
      socket.emit("ridersLocations", results);
    } else {
      console.log('No riders locations to send.');
    }
  });
};

  // Send initial data
  sendRidersLocations();

  // Send data periodically
  const intervalId = setInterval(sendRidersLocations, 10000); // every 10 seconds



  
});


// Dictionary to track rejected orders for each rider
const rejectedOrders = {}  ;

// Function to emit new order event to all connected riders
const emitNewOrder = () => {
    
          const fetchNewOrderQuery = `
            SELECT * FROM orders 
            WHERE orderStatus = "loading" 
            AND riderId IS NULL 
          `; 
          
          db.query(fetchNewOrderQuery, (err, orders) => {
    if (err) {
      console.error('Error fetching new order:', err);
      riderSocket.emit('error', { message: 'Error fetching new order', error: err }); // Emit error to all clients
      return;
    }

    if (orders.length > 0) {
      const newOrder = orders[0];
      const { storeLatitude, storeLongitude } = newOrder;

      // Fetch riders with socket_id and their location
      const fetchRidersQuery = 'SELECT id, socket_id, latitude, longitude FROM riders WHERE socket_id IS NOT NULL AND online = TRUE';
      db.query(fetchRidersQuery, (err, riders) => {
        if (err) {
          console.error('Error fetching riders:', err);
          riderSocket.emit('error', { message: 'Error fetching riders', error: err }); // Emit error to all clients
          return;
        }else{
        riderSocket.emit('error', { message: 'rider is not founds'}); // Emit error to all clients
        }

        riders.forEach(rider => {
          const distance = calculateDistance(storeLatitude, storeLongitude, rider.latitude, rider.longitude);

          if (distance <= 5) { // Assuming the distance is in kilometers and 5km is the range
            riderSocket.to(rider.socket_id).emit('newOrderAvailable', newOrder);
            console.log(`Notified rider ${rider.id} about new order ${newOrder.id}`);
          }else{
             riderSocket.emit('error', { message: 'the order is not in range of any rider'}); // Emit error to all clients
          }
        });
      });
    }else{
        io.emit('error', { message: 'order is not founds'}); // Emit error to all clients
 
    }
  });
}






// Socket.IO connection handling
riderSocket.on('connection', (socket) => {
  console.log('Client connected', socket.id);

  // Update rider's socket_id when they connect
  socket.on('riderConnect', (riderId) => {
  console.log("rider connected" , riderId)
 const query = 'UPDATE riders SET socket_id = ? WHERE id = ?';
  db.query(query, [socket.id, riderId], (err, result) => {
    if (err) {
      console.error('Error updating socket_id:', err);
        socket.emit('error' , err)
    }
    if (result.affectedRows === 0) {
        socket.emit('error' , "Rider not found")
    }
    socket.emit("updateSocketId" , "socket updated") 
  });


      // Initialize rejected orders list for this rider
      if (!rejectedOrders[riderId]) {
        rejectedOrders[riderId] = [];
      }
   
      

            

      // Fetch rider details
      const fetchRiderQuery = 'SELECT * FROM riders WHERE id = ?';
      db.query(fetchRiderQuery, [riderId], (err, riders) => {
        if (err) {
          console.error('Error fetching rider:', err);
          socket.emit('error', { message: 'Error fetching rider details', error: err });
          return;
        }

        if (riders.length === 0) {
          socket.emit('error', { message: 'Rider not found' });
          return;
        }

        const rider = riders[0];
        const riderLocation = { lat: parseFloat(rider.latitude), lng: parseFloat(rider.longitude) };
        const riderCarType = rider.car_type;

        // Function to fetch and assign order
const fetchAndAssignOrder = () => {
  let orderAssigned = false; // Flag to track if an order has been assigned
  console.log("start fetching order")
  // Check rider's online status and balance
  const checkRiderStatusQuery = 'SELECT online, balance FROM riders WHERE id = ?';
  db.query(checkRiderStatusQuery, [rider.id], (err, results) => {
    if (err) {
      console.error('Error checking rider status and balance:', err);
      socket.emit('error', { message: 'Error checking rider status and balance', error: err });
      return;
    }

    if (results.length === 0) {
      socket.emit('error', { message: 'Rider not found' });
      return;
    }

    const riderStatus = results[0];

    if (!riderStatus.online) {
      riderSocket.to(rider.socket_id).emit('error', { message: 'Rider is not online' });
      return;
    }

    if (riderStatus.balance <= 5) {
      riderSocket.to(rider.socket_id).emit('error', { message: 'Rider\'s balance is too low' });
      return;
    }
      console.log("rider is good :" , rider.id)


    // Fetch orders if the rider is online and has sufficient balance
    const excludedOrderIds = rejectedOrders[rider.id].length > 0 ? rejectedOrders[rider.id].join(',') : '';
    const fetchOrdersQuery = `
      SELECT * FROM orders 
      WHERE orderStatus = "loading" 
      AND (riderId IS NULL OR riderId = ?)
      AND riderIdAlt != ?
      ${excludedOrderIds && excludedOrderIds.length ? `AND id NOT IN (${excludedOrderIds})` : ''}
    `;

    db.query(fetchOrdersQuery, [rider.id, rider.id], (err, orders) => {
      if (err) {
        console.error('Error fetching orders:', err);
        socket.emit('error', { message: 'Error fetching orders', error: err });
        return;
      }

      if (orders.length === 0) {
        return;
      }
      console.log("order not rejected in rider :" , rider.id)
      console.log("orders : " , orders)
      let closestOrder = null;
      let minDistance = Infinity;

      orders.forEach(order => {
        const orderLocation = { lat: parseFloat(order.storeLatitude), lng: parseFloat(order.storeLongitude) };
        const distance = calculateDistance(riderLocation, orderLocation);

        if (order.carType) {
          if (distance <= 500000 && order.carType === riderCarType && distance < minDistance) {
            closestOrder = order;
            minDistance = distance;
          }
        } else {
          if (distance <= 500000 && (riderCarType === 'bike' || riderCarType === 'car') && distance < minDistance) {
            closestOrder = order;
            minDistance = distance;
          }
        }
      });

      if (closestOrder && !orderAssigned) {
        db.beginTransaction((err) => {
          if (err) {
            console.error('Error starting transaction:', err);
            socket.emit('error', { message: 'Error starting transaction', error: err });
            return;
          }

          // Mark rider as busy
          const markRiderBusyQuery = 'UPDATE riders SET online = FALSE WHERE id = ?';
          db.query(markRiderBusyQuery, [rider.id], (err) => {
            if (err) {
              console.error('Error marking rider as busy:', err);
              db.rollback(() => {
                socket.emit('error', { message: 'Error marking rider as busy', error: err });
              });
              return;
            }

            // Update the order with the riderId if it is currently null
            const updateOrderRiderIdQuery = 'UPDATE orders SET riderId = ? WHERE id = ? AND riderId IS NULL';
            db.query(updateOrderRiderIdQuery, [rider.id, closestOrder.id], (err, result) => {
              if (err) {
                console.error('Error updating order with riderId:', err);
                db.rollback(() => {
                  socket.emit('error', { message: 'Error updating order with riderId', error: err });
                });
                return;
              }

              if (result.affectedRows === 0) {
                db.rollback(() => {
                  console.log('Order already assigned to another rider.');
                });
                return;
              }

              db.commit((err) => {
                if (err) {
                  console.error('Error committing transaction:', err);
                  db.rollback(() => {
                    socket.emit('error', { message: 'Error committing transaction', error: err });
                  });
                  return;
                }

                riderSocket.to(rider.socket_id).emit('newOrder', closestOrder);
                console.log(`Notified rider ${rider.id} about new order ${closestOrder.id}`);

                orderAssigned = true; // Set flag to true after assigning the order
              });
            });
          });
        });
      }
    });
  });
};


        // Initial fetch and assign order
        fetchAndAssignOrder();
        const asignOrders = setInterval(fetchAndAssignOrder , 16000)

        // Listen for riderReady event to fetch new orders
        socket.on('riderReady', () => {
          // Mark rider as available
          const markRiderAvailableQuery = 'UPDATE riders SET online = TRUE WHERE id = ?';
          db.query(markRiderAvailableQuery, [rider.id], (err) => {
            if (err) {
              console.error('Error marking rider as available:', err);
              socket.emit('error', { message: 'Error marking rider as available', error: err });
              return;
            }

            // Fetch and assign new order
            fetchAndAssignOrder();

          });
        });
        
        

        // Handle order rejection
        socket.on('rejectOrder', (orderId) => {
          const queryReject = `
            UPDATE orders 
            SET riderId = NULL, orderStatus = "loading" 
            WHERE id = ? AND riderId = ?
          `;
          db.query(queryReject, [orderId, rider.id], (err, result) => {
            if (err) {
              console.error('Error updating order with riderId:', err);
              socket.emit('error', { message: 'Error updating order with riderId', error: err });
              return;
            }

            if (result.affectedRows === 0) {
              socket.emit('error', { message: 'Order not found or not assigned to this rider' });
              return;
            }

            // Add orderId to rejected orders list for this rider
            rejectedOrders[rider.id].push(orderId);

            // const decrementBalanceQuery = 'UPDATE riders SET balance = balance - 10 WHERE id = ?';
            // db.query(decrementBalanceQuery, [rider.id], (err) => {
              // if (err) {
              //   console.error('Error decrementing rider balance:', err);
              //   socket.emit('error', { message: 'Error decrementing rider balance', error: err });
              //   return;
              // }

              // Mark rider as available
              const markRiderAvailableQuery = 'UPDATE riders SET online = TRUE WHERE id = ?';
              db.query(markRiderAvailableQuery, [rider.id], (err) => {
                if (err) {
                  console.error('Error marking rider as available:', err);
                  socket.emit('error', { message: 'Error marking rider as available', error: err });
                  return;
                }

                socket.emit("rejected_order", { message: "The order has been rejected" });

                // Fetch and assign new order
                fetchAndAssignOrder();
              });
            // });
          });
        });

        // Listen for the newOrder event
        socket.on('newOrder', () => {
          emitNewOrder();
        });

        // Emit connected event with rider details
        socket.emit('riderConnected', {
          riderId: rider.id,
          riderName: rider.name,
          riderLocation: riderLocation
        });
      });

  });
  
  
  
  
  
  
  
socket.on('locationUpdate', (location, id) => {
    const riderId = id;
    const { latitude, longitude } = location;

    const query = `
      INSERT INTO riders (id, latitude, longitude)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE latitude = VALUES(latitude), longitude = VALUES(longitude)
    `;

    db.query(query, [riderId, latitude, longitude], (err, results) => {
      if (err) {
        console.error('Error updating location:', err);
        return;
      }
      socket.emit('locationUpdated' , location)
      console.log(`Location updated for rider ${riderId}:`, location);
    });
  });
 
 
  // Emit riders' locations to the client
  const sendRidersLocations = () => {
    const query = `
    SELECT id, latitude, longitude, car_type , socket_id 
    FROM riders
    WHERE socket_id != "" 
    `;

    db.query(query, (err, results) => {
      if (err) {
        console.error('Error fetching riders locations:', err);
        return;
      }
      socket.emit('ridersLocations', results);
      StoreSocket.emit("ridersLocations" , results)
    });
  };

  // Send initial data
  sendRidersLocations();

  // Send data periodically
  const intervalId = setInterval(sendRidersLocations, 5000); // every 10 seconds

 
  // Emit riders' locations to the client
  const sendStoresLocations = () => {
          const sql = 'SELECT businessName, businessType, totalOrders ,longitude, latitude FROM stores';
                db.query(sql, (err, results) => {
                    if (err) {
                         socket.emit('error', { message: 'Error fetching stores details', error: err });
                        return;
                    }
                    socket.emit("allStores" , results )
                });
  }


sendStoresLocations()




socket.on("updateOrder", (updateData) => {
  const { orderId, updateState, riderId, carType, riderPhone, matricule, riderName , storeId } = updateData;
 
  if (!updateState) {
    return socket.emit("error_Accept", "the update state is not found");
  }

  if (updateState === "loading") {
    const { riderIdAlt, carTypeAlt, riderPhoneAlt, matriculeAlt, riderNameAlt, riderLongAlt, riderLatAlt, risone } = updateData;

    if (riderIdAlt && carTypeAlt && riderPhoneAlt && matriculeAlt && riderNameAlt) {
 const updateQuery = `
  UPDATE orders 
  SET 
    orderStatus = ?, 
    riderId = ?, 
    carType = ?, 
    riderPhone = ?, 
    matricule = ?, 
    riderName = ?, 
    riderIdAlt = ?, 
    riderCarTypeAlt = ?, 
    riderPhoneAlt = ?, 
    riderMatriculeAlt = ?, 
    riderNameAlt = ?, 
    riderLongAlt = ?, 
    riderLatAlt = ?, 
    orderRejectedRaison = ? 
  WHERE 
    id = ?`;

const updateValues = [
  updateState, riderId, carType, riderPhone, matricule, riderName,
  riderIdAlt, carTypeAlt, riderPhoneAlt, matriculeAlt, riderNameAlt,
  riderLongAlt, riderLatAlt, risone, orderId
];

db.query(updateQuery, updateValues, (err, result) => {
  if (err) {
    console.error("Error updating order:", err);
    return;
  }

  // Fetch the updated order details
  const selectQuery = 'SELECT * FROM orders WHERE id = ?';
  db.query(selectQuery, [orderId], (err, orders) => {
    if (err) {
      console.error('Error fetching updated order:', err);
      return;
    }

    const updatedOrder = orders[0];

    // Emit event to notify clients about order update
    socket.emit("orderUpdated", { order: updatedOrder });

    if (updateState === "ACCEPTED") {
      const query = 'UPDATE riders SET online = 0 WHERE id = ?';
      db.query(query, [riderId], (err, results) => {
        if (err) {
          console.error('Error updating rider status:', err);
        } else {
           let text = "لقد تم قبول الطلب رقم " + orderId;
            const query = 'INSERT INTO notification (storeId, text) VALUES (?,?)';
            const values = [updatedOrder.storeId, text];
          
            db.query(query, values, (error, results) => {
              if (error) {
                return res.status(500).send({ error: 'Database error: ' + error });
              }
             socket.emit("acceptedOrder", { orderId, updateState, order: updatedOrder });
              console.log(`Rider ${riderId} status updated to offline`);
            });
        }
      })
    }
    
    
    
  })

        
        if (updateState === "PECKED") {
            let text = "لقد تم اخد الطلب رقم "+orderId
            // SQL query to insert into notifications table
              const sql = 'INSERT INTO notification (text, storeId) VALUES (?, ?)'
              const values = [text, storeId]
            
              // Execute the query with the values from req.body
              db.query(sql, values, (err, result) => {
                if (err) {
                  console.error('Error inserting notification:', err);
                  return;
                }
            
                // Return the ID of the inserted notification
                StoreSocket.emit('new_notification', { id: result.insertId, text, storeId, isRead : false });
              });
        }
        
         if (updateState === "DELIVERED") {
            let text = "تم توصيل طلب رقم "+orderId
            // SQL query to insert into notifications table
              const sql = 'INSERT INTO notification (text, storeId) VALUES (?, ?)'
              const values = [text, storeId]
            
              // Execute the query with the values from req.body
              db.query(sql, values, (err, result) => {
                if (err) {
                  console.error('Error inserting notification:', err);
                  return;
                }
            
                // Return the ID of the inserted notification
                StoreSocket.emit('new_notification', { id: result.insertId, text, storeId, isRead : false });
              });
        }
        
        
        
        

        if (updateState === "REJECTED") {
          const query = 'UPDATE riders SET online = 1 WHERE id = ?';
          db.query(query, [riderId], (err, results) => {
            if (err) {
              console.error('Error updating rider status:', err);
            } else {
              socket.emit("riderRejected", { orderId, updateState, order: result });
              console.log(`Rider ${riderId} status updated to online`);
            }
          });
        }
      });
      
      
    } else {
      return socket.emit("error_Accept", "need to fill all inputs");
    }
    
    
  } else {
    const updateQuery = `
      UPDATE orders 
      SET 
        orderStatus = ?, 
        riderId = ?, 
        carType = ?, 
        riderPhone = ?, 
        matricule = ?, 
        riderName = ? 
      WHERE 
        id = ?`;

    const updateValues = [updateState, riderId, carType, riderPhone, matricule, riderName, orderId];

    db.query(updateQuery, updateValues, (err, result) => {
      if (err) {
        console.error("Error updating order:", err);
        return;
      }

  // Fetch the updated order details
  const selectQuery = 'SELECT * FROM orders WHERE id = ?';
  db.query(selectQuery, [orderId], (err, orders) => {
    if (err) {
      console.error('Error fetching updated order:', err);
      return;
    }

    const updatedOrder = orders[0];

    // Emit event to notify clients about order update
    socket.emit("orderUpdated", { order: updatedOrder });

    if (updateState === "ACCEPTED") {
      const query = 'UPDATE riders SET online = 0 WHERE id = ?';
      db.query(query, [riderId], (err, results) => {
        if (err) {
          console.error('Error updating rider status:', err);
        } else {
          socket.emit("acceptedOrder", { orderId, updateState, order: updatedOrder });
          console.log(`Rider ${riderId} status updated to offline`);
        }
      });
      

      let text = "لقد تم قبول الطلب رقم " + orderId;
      // SQL query to insert into notifications table
      const sql = 'INSERT INTO notification (text, storeId) VALUES (?, ?)';
      const values = [text, storeId];

      // Execute the query with the values from req.body
      db.query(sql, values, (err, result) => {
        if (err) {
          console.error('Error inserting notification:', err);
          return;
        }

        // Return the ID of the inserted notification
        StoreSocket.emit('new_notification', { id: result.insertId, text, storeId, isRead: false });
      });
    }
    
    
    
  })
  
  
        
        
        if (updateState === "PECKED") {
            let text = "لقد تم اخد الطلب رقم "+orderId
            // SQL query to insert into notifications table
              const sql = 'INSERT INTO notification (text, storeId) VALUES (?, ?)'
              const values = [text, storeId]
            
              // Execute the query with the values from req.body
              db.query(sql, values, (err, result) => {
                if (err) {
                  console.error('Error inserting notification:', err);
                  return;
                }
            
                // Return the ID of the inserted notification
                StoreSocket.emit('new_notification', { id: result.insertId, text, storeId, isRead : false });
              });
        }
        
         if (updateState === "DELIVERED") {
            let text = "تم توصيل طلب رقم "+orderId
            // SQL query to insert into notifications table
              const sql = 'INSERT INTO notification (text, storeId) VALUES (?, ?)'
              const values = [text, storeId]
            
              // Execute the query with the values from req.body
              db.query(sql, values, (err, result) => {
                if (err) {
                  console.error('Error inserting notification:', err);
                  return;
                }
            
                // Return the ID of the inserted notification
                StoreSocket.emit('new_notification', { id: result.insertId, text, storeId, isRead : false });
              });
        }
        
        
      
      
      socket.emit("orderUpdated", { orderId, updateState, order: result });
    });
  }
});

  

  // Handle client disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
     const query = `
      INSERT INTO riders (socket_id, latitude, longitude)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE latitude = VALUES(latitude), longitude = VALUES(longitude)
    `;

    db.query(query, [socket.id, "", ""], (err, results) => {
      if (err) {
        console.error('Error updating location:', err);
        return;
      }
     
  
    // Emit disconnected event to handle clean-up if needed
     const query = 'UPDATE riders SET socket_id = ? WHERE socket_id = ?';
          db.query(query, [null, socket.id], (err, result) => {
            if (err) {
              console.error('Error updating socket_id:', err);
                socket.on('error' , err)
            }
            if (result.affectedRows === 0) {
                socket.on('error' , "Rider not found")
            }
             io.emit('clientDisconnected', socket.id);
          });


   

          console.log(`Location updated for desconnect rider ${socket.id}`);
    });
  })

  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket.IO error:', error);
    socket.emit('error', { message: 'Socket.IO server error', error: error });
  });
})






// Routes
app.get("/", (req, res) => {
  res.send('hello world');
});

app.get('/settings/socket-ip', (req, res) => {
  const query = 'SELECT socketIp FROM settings LIMIT 1';

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error executing query:', err);
      return res.status(500).send('Server error');
    }

    if (results.length > 0) {
      res.json({ socketIp: results[0].socketIp });
    } else {
      res.status(404).send('socketIp not found');
    }
  });
});




app.get('/order/by-rider/:riderId', (req, res) => {
  const riderId = req.params.riderId;

  // Updated query to include orderStatus conditions
  const searchQuery = 'SELECT * FROM orders WHERE riderId = ? AND (orderStatus = "ACCEPTED" OR orderStatus = "PEAKED") LIMIT 1';
  db.query(searchQuery, [riderId], (err, orders) => {
    if (err) {
      console.error('Error fetching order:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (orders.length === 0) {
      return res.status(404).json({ message: 'No order found for this rider' });
    }

    res.status(200).json({ order: orders[0] });
  });
});




// Orders endpoint
// app.get("/orders/rider/get", (req, res) => {
//   const { id } = req.query;
//   if (!id) {
//     return res.status(401).json({ message: "No rider Id found" });
//   }

//   const query = "SELECT * FROM riders WHERE id = ?";
//   db.query(query, [id], (err, results) => {
//     if (err) {
//       console.error("Error querying database:", err);
//       return res.status(500).json({ message: "Internal server error" });
//     }

//     if (results.length === 0) {
//       return res.status(404).json({ message: "Rider not found" });
//     }

//     const rider = results[0];
//     const riderLocation = { lat: parseFloat(rider.latitude), lng: parseFloat(rider.longitude) };

//     const query2 = "SELECT * FROM orders";
//     db.query(query2, (err, results) => {
//       if (err) {
//         console.error("Error querying database:", err);
//         return res.status(500).json({ message: "Internal server error" });
//       }

//       if (results.length === 0) {
//         return res.status(404).json({ message: "Orders not found" });
//       }

//       const ordersInMyArea = results.filter(order => {
//         const orderLocation = { lat: parseFloat(order.storeLatitude), lng: parseFloat(order.storeLongitude) };
//         const distance = calculateDistance(riderLocation, orderLocation);
//         if (order.carType) {
//           return distance <= 5000 && order.carType === rider.car_type;
//         } else {
//           return distance <= 5000 && (rider.car_type === 'bike' || rider.car_type === 'car');
//         }
//       });

//       const myOrders = results.filter(order => order.riderId === rider.id);
//       const loadingOrders = ordersInMyArea.filter(order => order.orderStatus === "loading");

//       console.log("otherOrders", loadingOrders);
//       console.log("my order", myOrders);

//       if (loadingOrders.length === 0) {
//         return res.status(404).json({ message: "No loading orders found in the specified area", myOrders: myOrders.reverse(), orders: [], ordersInMyArea: ordersInMyArea });
//       }

//       res.status(200).json({ message: "Loading orders found in the specified area", orders: loadingOrders.reverse(), myOrders: myOrders.reverse() });
//     });
//   });
// });



// Monitor database for new orders

// const checkForNewOrders = () => {
//   db.query('SELECT * FROM orders WHERE id > ?', [lastCheckedId], (error, results) => {
//     if (error) {
//       console.error('Error querying database:', error);
//       return;
//     }

//     if (results.length > 0) {
//       results.forEach(order => {
//         notifyClients(order);
//         lastCheckedId = Math.max(lastCheckedId, order.id);
//       });
//     }
//   });
// };

// setInterval(checkForNewOrders, 1000); // Check for new orders every second




// Register a new store
app.post('/register/stores', (req, res) => {
  const { phone, password, businessName, city, region, neighborhood, businessType , lat, lng } = req.body;

  // Validate required fields
  if (!phone || !password || !businessName || !city || !region || !businessType) {
    res.status(400).send({ error: 'Missing required fields' });
     return ;
  }
  
 // Check if the phone number already exists
  const checkPhoneQuery = 'SELECT COUNT(*) AS count FROM stores WHERE phone = ?';
  db.query(checkPhoneQuery, [phone], (error, results) => {
    if (error) {
       res.status(500).send({ error: 'Database error: ' + error });
       return ;
    }

    const phoneExists = results[0].count > 0;
    if (phoneExists) {
      res.status(401).send({ error: 'الرقم الدي ادخلته به حساب بلفعل' });
      return ;
    }

  })


  // Generate token
  const token = crypto.randomBytes(64).toString('hex');

  // Insert store into database
  const query = 'INSERT INTO stores (phone, password, businessName, name, city, region, neighborhood, latitude, longitude, token , businessType ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? , ? ,?)';
  const values = [phone, password, businessName,  businessName , city, region, neighborhood, lat, lng, token ,businessType ]
  db.query(query, values, (error, results) => {
    if (error) {
      return res.status(500).send({ error: 'Database error: ' + error });
    }
    res.status(201).send({ message: 'Store created successfully', storeId: results.insertId , sessionToken : token , store : results[0] });
  });
});

// Register a new rider
app.post('/register/rider', (req, res) => {
  const { phone, password, rating, name, city, carNumber, carType, lat, lng } = req.body;

  // Validate required fields
  if (!phone || !password || !city || !carNumber || !carType || !lat || !lng || !name) {
    return res.status(400).send({ error: 'Missing required fields' });
  }

  // Check if the phone number already exists
  const checkPhoneQuery = 'SELECT COUNT(*) AS count FROM riders WHERE phone = ?';
  db.query(checkPhoneQuery, [phone], (error, results) => {
    if (error) {
      return res.status(500).send({ error: 'Database error: ' + error });
    }

    const phoneExists = results[0].count > 0;
    if (phoneExists) {
      return res.status(401).send({ message: 'الرقم الذي أدخلته مستخدم بالفعل' });
    }

    // Generate token
    const token = crypto.randomBytes(64).toString('hex');

    // Insert rider into database
    const query = 'INSERT INTO riders (phone, password, rating, city, car_number, car_type, latitude, longitude, tokenSession, name , balance , online) VALUES (?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const values = [phone, password, rating, city, carNumber, carType, lat, lng, token, name , 500 , 1];
 
    db.query(query, values, (error, results) => {
      if (error) {
        return res.status(500).send({ error: 'Database error: ' + error });
      }
      res.status(201).send({ message: 'Rider created successfully', riderId: results.insertId, token });
    });
  });
});


// Login store
app.post('/login/stores', (req, res) => {
  const { phone, password } = req.body;
  console.log(req.body);

  // Validate required fields
  if (!phone || !password) {
    return res.status(400).json({ message: "Phone number and password are required" });
  }

  // Query the database to find the store with the provided phone number
  const query = "SELECT * FROM stores WHERE phone = ?";
  db.query(query, [phone], (err, results) => {
    if (err) {
      console.error("Error querying database:", err);
      return res.status(500).json({ message: "Internal server error" });
    }

    // Check if store with the provided phone number exists
    if (results.length === 0) {
      return res.status(404).json({ message: "لا  يوجد اي حساب بهادا الرقم" });
    }

    const store = results[0];

    // Check if the password matches
    if (password !== store.password) {
      return res.status(401).json({ message: "كلمة السر غير صحيحة" });
    }

    // Generate session token
    const sessionToken = crypto.randomBytes(64).toString('hex');

    // Update tokenSession column in the stores table
    const updateQuery = "UPDATE stores SET token = ? WHERE id = ?";
    db.query(updateQuery, [sessionToken, store.id], (err, result) => {
      if (err) {
        console.error("Error updating token:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
      // Login successful
      return res.status(200).json({ message: "Login successful", sessionToken , store  });
    });
  });
});

// Login rider
app.post('/login/rider', (req, res) => {
  const { phone, password } = req.body;
  console.log(req.body);
  // Validate required fields
  if (!phone || !password) {
    return res.status(400).json({ message: "المرجو ادخال رقم الهاتف وكلمة المرور" });
  }
  // Query the database to find the rider with the provided phone number
  const query = "SELECT * FROM riders WHERE phone = ?";
  db.query(query, [phone], (err, results) => {
    if (err) {
      console.error("Error querying database:", err);
      return res.status(500).json({ message: "حدت  خطاء في الخادم" });
    }
    // Check if rider with the provided phone number exists
    if (results.length === 0) {
      return res.status(404).json({ message: "لا يوجد اي حساب بهادا الرقم" });
    }
    const rider = results[0];
    // Check if the password matches
    if (password !== rider.password) {
      return res.status(401).json({ message: "كلمة المرور خطأ" });
    }
    // Generate session token
    const sessionToken = crypto.randomBytes(64).toString('hex');
    // Update tokenSession column in the riders table
    const updateQuery = "UPDATE riders SET tokenSession = ? WHERE id = ?";
    db.query(updateQuery, [sessionToken, rider.id], (err, result) => {
      if (err) {
        console.error("Error updating tokenSession:", err);
        return res.status(500).json({ message: "حدت  خطاء في الخادم" });
      }
      // Login successful
      return res.status(200).json({ message: "تم تسجيل الدخول بنجاح", rider ,sessionToken });
    });
  });
});





// ===================== get data ========================


app.get("/stores/data" , (req ,res)=>{

    const {token}  =  req.query

    if(!token)
      {
        return res.status(400).json({message : "No token sen to server"}) ;
      }

  const query = "SELECT * FROM stores WHERE token = ?";
  db.query(query, [token], (err, results) => {
    if (err) {
      console.error("Error querying database:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
    if (results.length === 0) {
      return res.status(404).json({ message: "Store not found" });
    }
    const store = results[0];
  
    res.status(200).json({message : "store found " , store})
  })
  
})


app.get("/rider/data" , (req ,res)=>{

  const {token}  =  req.query

  if(!token)
    {
      return res.status(400).json({message : "No token sen to server"}) ;
    }

const query = "SELECT * FROM riders WHERE tokenSession = ?";
db.query(query, [token], (err, results) => {
  if (err) {
    console.error("Error querying database:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
  if (results.length === 0) {
    return res.status(404).json({ message: "Rider not found" });
  }
  const rider = results[0];
  
  res.status(200).json({message : "store found " , rider})
})

})





app.post("/rider/updateLocation", (req, res) => {
  const { token, latitude, longitude } = req.body;

  if (!token) {
    return res.status(400).json({ message: "Token, are required" });
  }

  const updateQuery = "UPDATE riders SET latitude = ?, longitude = ? WHERE tokenSession = ?";
  db.query(updateQuery, [latitude, longitude, token], (err, results) => {
    if (err) {
      console.error("Error updating database:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ message: "Rider not found" })
    }

    res.status(200).json({ message: "Location updated successfully" });
  });
});




// ========================================== orders ============================================

app.get("/order/get" , (req , res)=>{
  const {storeId} = req.query
  if(!storeId){
    return res.status(401).json({message : "No store Id found"})
  }
  const query = "SELECT * FROM orders WHERE storeId = ?";
    db.query(query, [storeId], (err, results) => {
      if (err) {
        console.error("Error querying database:", err);
        return res.status(500).json({ message: "Internal server error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Orders not found" });
      }

      // const orders = results[0];
      const orders = results.map(order => {
        return order
      });

      res.status(200).json({message : "orders found " ,orders : orders.reverse()})
    })
})


app.get("/order/getSingle" , (req , res)=>{
  const {id} = req.query
  if(!id){
    return res.status(401).json({message : "No order Id found"})
  }
  const query = "SELECT * FROM orders WHERE id = ?";
    db.query(query, [id], (err, results) => {
      if (err) {
        console.error("Error querying database:", err);
        return res.status(500).json({ message: "Internal server error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "order not found" });
      }

      // const orders = results[0];
      

      res.status(200).json({message : "orders found " , order : results[0]})
    })
})



app.post("/order/update", (req, res) => {
  const { updateState, orderId } = req.query;
  const { riderId, carType, riderPhone, matricule, riderName } = req.body;

  if (!updateState) {
    return res.status(401).json({ message: "No order Id found" });
  }
  
  if(updateState == "loading"){
      
        const {  riderIdAlt, carTypeAlt, riderPhoneAlt, matriculeAlt, riderNameAlt , riderLongAlt , riderLatAlt  ,risone } = req.body
        
        if(riderIdAlt&& carTypeAlt &&  riderPhoneAlt &&  matriculeAlt&& riderNameAlt){
            
          const updateQuery = "UPDATE orders SET orderStatus = ?, riderId = ?, carType = ?, riderPhone = ?, matricule = ?, riderName = ?, riderIdAlt = ?, riderCarTypeAlt = ?, riderPhoneAlt = ?, riderMatriculeAlt = ?, riderNameAlt = ?, riderLongAlt = ?, riderLatAlt = ?, orderRejectedRaison = ? WHERE id = ?";
            const updateValues = [updateState, riderId, carType, riderPhone, matricule, riderName, riderIdAlt, carTypeAlt, riderPhoneAlt, matriculeAlt, riderNameAlt, riderLongAlt, riderLatAlt, risone, orderId];
            
            db.query(updateQuery, updateValues, (err, result) => {
              if (err) {
                console.error("Error updating order:", err);
                return res.status(500).json({ message: "حدث خطأ في الخادم" });
              }
              return res.status(200).json({ message: "تم التعديل", order: result });
            });
        }else{
            return res.status(400).json({message : "you need to fill the variables"})
        }
  }else{
  const updateQuery = "UPDATE orders SET orderStatus = ?, riderId = ?, carType = ?, riderPhone = ?, matricule = ?, riderName = ? WHERE id = ?";
  const updateValues = [updateState, riderId, carType, riderPhone, matricule, riderName, orderId];

  db.query(updateQuery, updateValues, (err, result) => {
    if (err) {
      console.error("Error updating order:", err);
      return res.status(500).json({ message: "حدث خطأ في الخادم" });
    }
    return res.status(200).json({ message: "تم التعديل", order: result[0] });
  });
  }
})






app.post("/order/updateComment", (req, res) => {
  const {orderId } = req.query;
  const { rating, raison} = req.body;

  if (!orderId) {
    return res.status(401).json({ message: "No order Id found" });
  }

  const updateQuery = "UPDATE orders SET rating = ?, reason = ? WHERE id = ?";
  const updateValues = [rating, raison , orderId];

  db.query(updateQuery, updateValues, (err, result) => {
    if (err) {
      console.error("Error updating order:", err);
      return res.status(500).json({ message: "حدث خطأ في الخادم" });
    }
    return res.status(200).json({ message: "تم التعديل", order: result[0] });
  });
});




app.post("/order/add", (req, res) => {
  let {
    storeId,
    storePlace,
    riderPrice,
    customerName,
    customerNumber,
    carType,
    storeLongitude,
    storeLatitude,
    destinationInKm,
    customerLng,
    customerLat,
    customerAddress,
    storeName,
    storeNumber
  } = req.body;

  const { id } = req.query;

  if (!storeId || !storePlace || !storeLongitude || !storeLatitude) {
    const query = "SELECT * FROM stores WHERE id = ?";
    db.query(query, [id], (err, results) => {
      if (err) {
        console.error("Error querying database:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: "Store not found" });
      }

      const store = results[0];
      const insertQuery = `
        INSERT INTO orders (
          storeId,
          storePlace,
          orderAmount,
          customerName,
          customerPhone,
          storeLatitude,
          storeLongitude,
          carType,
          destinationInKm,
          customerLat,
          customerLng,
          orderStatus,
          customerAdress,
          storeNumber,
          storeName
        ) VALUES (?,?,?,?,?, ?, ?, ?, ?, ?, ?, ?, ? ,? ,?)`;

      const values = [
        store.id,
        store.neighborhood,
        riderPrice,
        customerName,
        customerNumber,
        store.latitude,
        store.longitude,
        carType,
        destinationInKm,
        customerLat,
        customerLng,
        "loading",
        customerAddress,
        store.phone,
        store.name
      ];

      db.query(insertQuery, values, (error, results) => {
        if (error) {
          return res.status(500).send({ error: 'Database error: ' + error });
        }

        // Emitting the new order event to clients connected to StoreSocket
        StoreSocket.emit('newOrder', {
          message: 'تمت اضافة الطلب بنجاح',
          riderId: results.insertId
        });

        res.status(201).send({
          message: 'تمت اضافة الطلب بنجاح',
          riderId: results.insertId
        });
      });
    });
  } else {
    const insertQuery = `
      INSERT INTO orders (
        storeId,
        storePlace,
        orderAmount,
        customerName,
        customerPhone,
        storeLatitude,
        storeLongitude,
        carType,
        destinationInKm,
        customerLat,
        customerLng,
        orderStatus,
        customerAdress,
        storeNumber,
        storeName
      ) VALUES (?,?,?,?,?, ?, ?, ?, ?, ?, ?, ?, ? ,? ,?)`;

    const values = [
      storeId,
      storePlace,
      riderPrice,
      customerName,
      customerNumber,
      storeLatitude,
      storeLongitude,
      carType,
      destinationInKm,
      customerLat,
      customerLng,
      "loading",
      customerAddress,
      storeNumber,
      storeName
    ];

    db.query(insertQuery, values, (error, results) => {
      if (error) {
        return res.status(500).send({ error: 'Database error: ' + error });
      }

      // Emitting the new order event to clients connected to StoreSocket
      StoreSocket.emit('newOrder', {
        message: 'تمت اضافة الطلب بنجاح',
        riderId: results.insertId
      });

      res.status(201).send({
        message: 'تمت اضافة الطلب بنجاح',
        riderId: results.insertId
      });
    });
  }
});



   
// ===================== notification ============================

app.get('/notification/get' , (req , res)=>{
  const {storeId}  = req.query

  if(!storeId)
    {
      return res.status(400).json({message : "No storeId sent to server"}) ;
    }

const query = "SELECT * FROM notification WHERE storeId = ?";
db.query(query, [+storeId], (err, results) => {
  if (err) {
    console.error("Error querying database:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
  if (results.length === 0) {
    return res.status(404).json({ message: "notification not found" });
  }
  const notification = results[0];

  const notifications = results.map(notification => {
    return notification
  });

  console.log(notifications);

  res.status(200).json({ message: "Notifications found", notifications: notifications.reverse() });
})})


app.post("/notification/add" , (req , res)=>{
  const {storeId , text  , date } = req.body

  if(!storeId || !text  ){
    res.json({message : "need to insert data" })
  }
  const query = 'INSERT INTO notification (storeId, text, date) VALUES (?,?,?)';
  const values = [storeId, text, date];

  db.query(query, values, (error, results) => {
    if (error) {
      return res.status(500).send({ error: 'Database error: ' + error });
    }
    res.status(201).send({ message: 'notification created successfully', riderId: results.insertId });
  });
})

app.post('/notification/update', (req, res) => {
  const notificationId = req.query.updateId;

  // SQL query to update isRead to true
  const sql = 'UPDATE notification SET isRead = 1 WHERE id = ?';

  // Execute the query with the notificationId parameter
  db.query(sql, [notificationId], (err, results) => {
    if (err) {
      console.error('Error updating notification:', err);
      res.status(500).json({ error: 'Failed to update notification' });
      return;
    }

    // Check if update was successful
    if (results.affectedRows > 0) {
      res.json({ message: `Notification ${notificationId} updated successfully` });
    } else {
      res.status(404).json({ error: `Notification ${notificationId} not found` });
    }
  });
  
});





// ==================== Riders ======================

app.get('/riders/get', (req, res) => {
  const { lat, lng } = req.query; // Assuming lat, lng, and radius are sent as query parameters
  const userLocation = { lat: parseFloat(lat), lng: parseFloat(lng) };
  
  const query = "SELECT * FROM riders WHERE latitude IS NOT NULL AND longitude IS NOT NULL";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error querying database:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
         const  radius = 500000 ;

    const ridersInArea = results.filter(rider => {
      const riderLocation = { lat: rider.latitude, lng: rider.longitude }; // Assuming your riders table has latitude and longitude 
      console.log(riderLocation)
      const distance = calculateDistance(userLocation, riderLocation);
      console.log(distance)
      return distance <= radius;
    });

    if (ridersInArea.length === 0) {
      return res.status(404).json({ message: "No riders found in the specified area" });
    }

    res.status(200).json({ message: "Riders found in the specified area", riders: ridersInArea });
  });
});

// ================ transaction  ======================
app.post("/transaction/decrement", (req, res) => {
    const { id } = req.query;
    const count = 10;
    let  date = new Date()
    date = date.getDate();


    // Query to fetch rider's balance
    const selectBalanceQuery = "SELECT balance FROM riders WHERE id = ?";
    db.query(selectBalanceQuery, [id], (err, riderResults) => {
        if (err) {
            console.error("Error querying rider database:", err);
            return res.status(500).json({ message: "Failed to fetch rider balance" });
        }

        if (riderResults.length === 0) {
            return res.status(404).json({ message: "Rider not found" });
        }

        const riderBalance = riderResults[0].balance;

        // Check if rider has enough balance for the transaction
        if (+riderBalance >= count) {
            // Calculate new balance after decrementing
            const newBalance = +riderBalance - count;

            // Update rider's balance
            const updateBalanceQuery = "UPDATE riders SET balance = ? WHERE id = ?";
            db.query(updateBalanceQuery, [newBalance, id], (err, updateResults) => {
                if (err) {
                    console.error("Error updating rider balance:", err);
                    return res.status(500).json({ message: "Failed to update rider balance" });
                }

                // Insert transaction information
                const insertTransactionQuery = "INSERT INTO transaction (user_id, count, date) VALUES (?, ?, ?)";
                db.query(insertTransactionQuery, [+id, count, date], (err, transactionResults) => {
                    if (err) {
                        console.error("Error inserting transaction into database:", err);
                        return res.status(500).json({ message: "Failed to insert transaction" });
                    }

                    res.status(200).json({ message: "Transaction completed", newBalance, success: true });
                });
            });
        } else {
            // If rider's balance is not sufficient for the transaction
            res.status(200).json({ message: "Transaction skipped, balance is zero or negative", success: false });
        }
    });
});




app.get("/getMyTransaction", (req, res) => {
  const { id } = req.query;

  // Query to fetch transaction information
  const query = "SELECT * FROM transaction WHERE user_id = ?";
  db.query(query, [+id], (err, transactionResults) => {
      if (err) {
          console.error("Error querying transaction database:", err);
          return res.status(500).json({ message: "Internal server error" });
      }
    //   if (transactionResults.length === 0) {
    //       return res.status(404).json({ message: "Transaction not found" });
    //   }

      // Query to fetch rider sold information
      const query2 = "SELECT balance FROM riders WHERE id = ?";
      db.query(query2, [id], (err, riderResults) => {
          if (err) {
              console.error("Error querying rider database:", err);
              return res.status(500).json({ message: "Internal server error" });
          }

          const transactions = transactionResults.map(transaction => {
              return transaction;
          });
          const riderSold = riderResults[0].balance
          res.status(200).json({ message: "Transaction and rider sold found", transactions: transactions?.reverse(), riderSold: riderSold });
      });
  });
});




app.get("/settings/get" , (req , res)=>{
 
  const query = "SELECT * FROM settings";
    db.query(query, (err, results) => {
      if (err) {
        console.error("Error querying database:", err);
        return res.status(500).json({ message: "Internal server error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "order not found" });
      }

      
      

      res.status(200).json({message : "settings found " , settings : results[0]})
    })
})



app.get("/rider/getOnline", (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(401).json({ message: "No rider Id found" });
  }
  const query = "SELECT online FROM riders WHERE id = ?";
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error querying database:", err);
      return res.status(500).json({ message: "Internal server error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Rider not found" });
    }

    const online = results[0].online;
    res.status(200).json({ id: id, online: online });
  });
});



app.post("/rider/updateOnline", (req, res) => {
  const { id, online } = req.body;
  if (!id || online === undefined) {
    return res.status(400).json({ message: "Rider ID and online status are required" });
  }

  const query = "UPDATE riders SET online = ? WHERE id = ?";
  db.query(query, [online, id], (err, results) => {
    if (err) {
      console.error("Error updating database:", err);
      return res.status(500).json({ message: "Internal server error" });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ message: "Rider not found" });
    }

    res.status(200).json({ message: "Rider online status updated successfully" });
  });
});



console.log("not")
// Start the server
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
